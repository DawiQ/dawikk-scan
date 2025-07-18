#ifdef __APPLE__
#include <TargetConditionals.h>
#if TARGET_OS_IOS || TARGET_OS_IPHONE_SIMULATOR
// iOS specific fixes
#define MOBILE_BUILD 1
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#endif
#endif

#include "scan_bridge.h"

// Include all necessary Scan engine headers
#include "../scan/src/bb_base.hpp"
#include "../scan/src/bb_comp.hpp"
#include "../scan/src/bb_index.hpp"
#include "../scan/src/bit.hpp"
#include "../scan/src/book.hpp"
#include "../scan/src/common.hpp"
#include "../scan/src/eval.hpp"
#include "../scan/src/fen.hpp"     // THIS WAS MISSING - contains pos_hub and pos_from_hub
#include "../scan/src/game.hpp"
#include "../scan/src/gen.hpp"
#include "../scan/src/hash.hpp"
#include "../scan/src/hub.hpp"
#include "../scan/src/libmy.hpp"
#include "../scan/src/move.hpp"
#include "../scan/src/pos.hpp"
#include "../scan/src/search.hpp"
#include "../scan/src/sort.hpp"
#include "../scan/src/thread.hpp"
#include "../scan/src/tt.hpp"
#include "../scan/src/util.hpp"   // THIS WAS MISSING - contains Bad_Input
#include "../scan/src/var.hpp"

#include <stdio.h>
#include <unistd.h>
#include <string>
#include <vector>
#include <array>
#include <algorithm>
#include <iostream>
#include <cstring>
#include <sstream>
#include <thread>
#include <atomic>

namespace {
    constexpr int NUM_PIPES = 2;
    constexpr int PARENT_WRITE_PIPE = 0;
    constexpr int PARENT_READ_PIPE = 1;
    constexpr int READ_FD = 0;
    constexpr int WRITE_FD = 1;

    constexpr size_t BUFFER_SIZE = 4096;

    std::array<std::array<int, 2>, NUM_PIPES> pipes;
    std::vector<char> buffer(BUFFER_SIZE);
    std::thread engine_thread;
    std::atomic<bool> engine_running{false};

    #define PARENT_READ_FD (pipes[PARENT_READ_PIPE][READ_FD])
    #define PARENT_WRITE_FD (pipes[PARENT_WRITE_PIPE][WRITE_FD])
}

// Global variable for engine status
static std::atomic<bool> g_engine_running{false};

// Forward declaration of Scan's main hub loop
static void hub_loop();

extern "C" {

int scan_init(void) {
    // Create communication pipes
    if (pipe(pipes[PARENT_READ_PIPE].data()) != 0) {
        return -1;
    }
    if (pipe(pipes[PARENT_WRITE_PIPE].data()) != 0) {
        return -1;
    }
    return 0;
}

int scan_main(void) {
    if (engine_running.load()) {
        return 0; // Already running
    }

    // Start engine in separate thread
    engine_thread = std::thread([]() {
        // Redirect stdin and stdout through our pipes
        dup2(pipes[PARENT_WRITE_PIPE][READ_FD], STDIN_FILENO);
        dup2(pipes[PARENT_READ_PIPE][WRITE_FD], STDOUT_FILENO);
        
        engine_running.store(true);
        g_engine_running.store(true);
        
        try {
            // Initialize Scan engine components
            bit::init();
            hash::init();
            pos::init();
            var::init();

            bb::index_init();
            bb::comp_init();

            ml::rand_init();

            // Start listening for input from React Native
            listen_input();
            bit::init(); // depends on the variant

            // Run the actual Scan HUB protocol loop
            hub_loop();
        } catch (const std::exception& e) {
            std::cerr << "Error in Scan engine: " << e.what() << std::endl;
        } catch (...) {
            std::cerr << "Unknown error in Scan engine" << std::endl;
        }
        
        engine_running.store(false);
        g_engine_running.store(false);
    });
    
    engine_thread.detach();
    return 0;
}

const char* scan_stdout_read(void) {
    static std::string output;
    output.clear();

    ssize_t bytesRead;
    while ((bytesRead = read(PARENT_READ_FD, buffer.data(), BUFFER_SIZE)) > 0) {
        output.append(buffer.data(), bytesRead);
        if (output.back() == '\n') {
            break;
        }
    }

    if (bytesRead < 0) {
        return nullptr;
    }

    return output.c_str();
}

int scan_stdin_write(const char* data) {
    if (!g_engine_running.load()) {
        return 0;
    }
    
    ssize_t bytesWritten = write(PARENT_WRITE_FD, data, strlen(data));
    // Ensure proper line ending
    if (bytesWritten > 0 && data[strlen(data) - 1] != '\n') {
        write(PARENT_WRITE_FD, "\n", 1);
    }
    return bytesWritten >= 0 ? 1 : 0;
}

void scan_shutdown(void) {
    if (g_engine_running.load()) {
        scan_stdin_write("quit");
        g_engine_running.store(false);
        engine_running.store(false);
        if (engine_thread.joinable()) {
            engine_thread.join();
        }
    }
    
    // Close pipes
    close(pipes[PARENT_READ_PIPE][READ_FD]);
    close(pipes[PARENT_READ_PIPE][WRITE_FD]);
    close(pipes[PARENT_WRITE_PIPE][READ_FD]);
    close(pipes[PARENT_WRITE_PIPE][WRITE_FD]);
}

} // extern "C"

// Implementation of hub_loop from main.cpp
static void hub_loop() {
    Game game;
    Search_Input si;

    while (g_engine_running.load()) {
        try {
            std::string line = hub::read();
            hub::Scanner scan(line);

            if (scan.eos()) { // empty line
                hub::error("missing command");
                continue;
            }

            std::string command = scan.get_command();

            if (command == "go") {
                bool think = false;
                bool ponder = false;
                bool analyze = false;

                while (!scan.eos()) {
                    auto p = scan.get_pair();

                    if (p.name == "think") {
                        think = true;
                    } else if (p.name == "ponder") {
                        ponder = true;
                    } else if (p.name == "analyze") {
                        analyze = true;
                    }
                }

                si.move = !analyze;
                si.book = !analyze;
                si.input = true;
                si.output = Output_Hub;
                si.ponder = ponder;

                Search_Output so;
                search(so, game.node(), si);

                Move move = so.move;
                Move answer = so.answer;

                if (move == move::None) move = quick_move(game.node());

                if (move != move::None && answer == move::None) {
                    answer = quick_move(game.node().succ(move));
                }

                Pos p0 = game.pos();
                Pos p1 = p0;
                if (move != move::None) p1 = p0.succ(move);

                std::string line = "done";
                if (move   != move::None) hub::add_pair(line, "move",   move::to_hub(move, p0));
                if (answer != move::None) hub::add_pair(line, "ponder", move::to_hub(answer, p1));
                hub::write(line);

                si.init(); // reset level

            } else if (command == "hub") {
                std::string line = "id";
                hub::add_pair(line, "name", Engine_Name);
                hub::add_pair(line, "version", Engine_Version);
                hub::add_pair(line, "author", "Fabien Letouzey");
                hub::add_pair(line, "country", "France");
                hub::write(line);

                // Engine parameters
                std::string param_line = "param";
                hub::add_pair(param_line, "name", "variant");
                hub::add_pair(param_line, "value", "normal");
                hub::add_pair(param_line, "type", "enum");
                hub::add_pair(param_line, "values", "normal killer bt frisian losing");
                hub::write(param_line);

                param_line = "param";
                hub::add_pair(param_line, "name", "book");
                hub::add_pair(param_line, "value", "true");
                hub::add_pair(param_line, "type", "bool");
                hub::write(param_line);

                param_line = "param";
                hub::add_pair(param_line, "name", "book-ply");
                hub::add_pair(param_line, "value", "4");
                hub::add_pair(param_line, "type", "int");
                hub::add_pair(param_line, "min", "0");
                hub::add_pair(param_line, "max", "20");
                hub::write(param_line);

                param_line = "param";
                hub::add_pair(param_line, "name", "book-margin");
                hub::add_pair(param_line, "value", "4");
                hub::add_pair(param_line, "type", "int");
                hub::add_pair(param_line, "min", "0");
                hub::add_pair(param_line, "max", "100");
                hub::write(param_line);

                param_line = "param";
                hub::add_pair(param_line, "name", "threads");
                hub::add_pair(param_line, "value", "1");
                hub::add_pair(param_line, "type", "int");
                hub::add_pair(param_line, "min", "1");
                hub::add_pair(param_line, "max", "16");
                hub::write(param_line);

                param_line = "param";
                hub::add_pair(param_line, "name", "tt-size");
                hub::add_pair(param_line, "value", "24");
                hub::add_pair(param_line, "type", "int");
                hub::add_pair(param_line, "min", "16");
                hub::add_pair(param_line, "max", "30");
                hub::write(param_line);

                param_line = "param";
                hub::add_pair(param_line, "name", "bb-size");
                hub::add_pair(param_line, "value", "5");
                hub::add_pair(param_line, "type", "int");
                hub::add_pair(param_line, "min", "0");
                hub::add_pair(param_line, "max", "7");
                hub::write(param_line);

                hub::write("wait");

            } else if (command == "init") {
                // Initialize engine components
                try {
                    bit::init(); // depends on the variant
                    if (var::Book) {
                        try {
                            book::init();
                        } catch (...) {
                            // Book initialization failed, disable book
                            var::set("book", "false");
                            var::update();
                        }
                    }
                    if (var::BB) {
                        try {
                            bb::init();
                        } catch (...) {
                            // BB initialization failed, disable bitbases
                            var::set("bb-size", "0");
                            var::update();
                        }
                    }

                    eval_init();
                    G_TT.set_size(var::TT_Size);
                } catch (const std::exception& e) {
                    std::cerr << "Init error: " << e.what() << std::endl;
                }
                
                hub::write("ready");

            } else if (command == "level") {
                int depth = -1;
                int64 nodes = -1;
                double move_time = -1.0;

                bool smart = false;
                int moves = 0;
                double game_time = 30.0;
                double inc = 0.0;

                bool infinite = false;
                bool ponder = false;

                while (!scan.eos()) {
                    auto p = scan.get_pair();

                    if (p.name == "depth") {
                        depth = std::stoi(p.value);
                    } else if (p.name == "nodes") {
                        nodes = std::stoll(p.value);
                    } else if (p.name == "move-time") {
                        move_time = std::stod(p.value);
                    } else if (p.name == "moves") {
                        smart = true;
                        moves = std::stoi(p.value);
                    } else if (p.name == "time") {
                        smart = true;
                        game_time = std::stod(p.value);
                    } else if (p.name == "inc") {
                        smart = true;
                        inc = std::stod(p.value);
                    } else if (p.name == "infinite") {
                        infinite = true;
                    } else if (p.name == "ponder") {
                        ponder = true;
                    }
                }

                if (depth >= 0) si.depth = Depth(depth);
                if (nodes >= 0) si.nodes = nodes;
                if (move_time >= 0.0) si.time = move_time;

                if (smart) si.set_time(moves, game_time, inc);

            } else if (command == "new-game") {
                G_TT.clear();

            } else if (command == "ping") {
                hub::write("pong");

            } else if (command == "ponder-hit") {
                // no-op (handled during search)

            } else if (command == "pos") {
                std::string pos = pos_hub(pos::Start);
                std::string moves;

                while (!scan.eos()) {
                    auto p = scan.get_pair();

                    if (p.name == "start") {
                        pos = pos_hub(pos::Start);
                    } else if (p.name == "pos") {
                        pos = p.value;
                    } else if (p.name == "moves") {
                        moves = p.value;
                    }
                }

                // position
                try {
                    game.init(pos_from_hub(pos));
                } catch (const Bad_Input &) {
                    hub::error("bad position");
                    continue;
                } catch (...) {
                    hub::error("bad position format");
                    continue;
                }

                // moves
                std::stringstream ss(moves);
                std::string arg;

                while (ss >> arg) {
                    try {
                        Move mv = move::from_hub(arg, game.pos());

                        if (!move::is_legal(mv, game.pos())) {
                            hub::error("illegal move");
                            break;
                        } else {
                            game.add_move(mv);
                        }

                    } catch (const Bad_Input &) {
                        hub::error("bad move");
                        break;
                    } catch (...) {
                        hub::error("bad move format");
                        break;
                    }
                }

                si.init(); // reset level

            } else if (command == "quit") {
                g_engine_running.store(false);
                break;

            } else if (command == "set-param") {
                std::string name;
                std::string value;

                while (!scan.eos()) {
                    auto p = scan.get_pair();

                    if (p.name == "name") {
                        name = p.value;
                    } else if (p.name == "value") {
                        value = p.value;
                    }
                }

                if (name.empty()) {
                    hub::error("missing name");
                    continue;
                }

                try {
                    var::set(name, value);
                    var::update();
                } catch (...) {
                    hub::error("invalid parameter");
                }

            } else if (command == "stop") {
                // no-op (handled during search)

            } else { // unknown command
                hub::error("bad command");
                continue;
            }
        } catch (const std::exception& e) {
            std::cerr << "Hub loop error: " << e.what() << std::endl;
            hub::error("internal error");
        } catch (...) {
            std::cerr << "Unknown hub loop error" << std::endl;
            hub::error("unknown error");
        }
    }
}