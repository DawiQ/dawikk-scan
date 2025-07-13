#include "scan_bridge.h"
#include <stdio.h>
#include <unistd.h>
#include <string>
#include <vector>
#include <array>
#include <algorithm>
#include <iostream>
#include <cstring>

// Namespace dla wewnętrznych definicji
namespace {
    constexpr int NUM_PIPES = 2;
    constexpr int PARENT_WRITE_PIPE = 0;
    constexpr int PARENT_READ_PIPE = 1;
    constexpr int READ_FD = 0;
    constexpr int WRITE_FD = 1;
    constexpr size_t BUFFER_SIZE = 4096;

    const char* QUITOK = "quitok\n";
    std::array<std::array<int, 2>, NUM_PIPES> pipes;
    std::vector<char> buffer(BUFFER_SIZE);

    #define PARENT_READ_FD (pipes[PARENT_READ_PIPE][READ_FD])
    #define PARENT_WRITE_FD (pipes[PARENT_WRITE_PIPE][WRITE_FD])
}

// Include Scan headers
#include "../scan/bit.hpp"
#include "../scan/common.hpp"
#include "../scan/game.hpp"
#include "../scan/gen.hpp"
#include "../scan/hash.hpp"
#include "../scan/hub.hpp"
#include "../scan/libmy.hpp"
#include "../scan/move.hpp"
#include "../scan/pos.hpp"
#include "../scan/search.hpp"
#include "../scan/var.hpp"
#include "../scan/bb_base.hpp"
#include "../scan/bb_comp.hpp"
#include "../scan/bb_index.hpp"

// Forward declarations
static void hub_loop_bridge();
static void init_scan_low();

extern "C" {

int scan_init(void) {
    // Create communication pipes
    pipe(pipes[PARENT_READ_PIPE].data());
    pipe(pipes[PARENT_WRITE_PIPE].data());
    return 0;
}

int scan_main(void) {
    // Redirect stdin and stdout
    dup2(pipes[PARENT_WRITE_PIPE][READ_FD], STDIN_FILENO);
    dup2(pipes[PARENT_READ_PIPE][WRITE_FD], STDOUT_FILENO);

    // Initialize Scan components
    bit::init();
    hash::init();
    pos::init();
    var::init();

    bb::index_init();
    bb::comp_init();

    ml::rand_init();

    // Wczytaj konfigurację jeśli istnieje
    var::load("scan.ini");

    // Start Hub protocol loop (bazowane na hub_loop() z main.cpp)
    hub_loop_bridge();
    
    std::cout << QUITOK << std::flush;
    return 0;
}

const char* scan_stdout_read(void) {
    static std::string output;
    output.clear();

    ssize_t bytesRead;
    while ((bytesRead = read(PARENT_READ_FD, buffer.data(), BUFFER_SIZE)) > 0) {
        output.append(buffer.data(), bytesRead);
        if (output.back() == '\n' || output.find(QUITOK) != std::string::npos) {
            break;
        }
    }

    if (bytesRead < 0) {
        return nullptr;
    }

    return output.c_str();
}

int scan_stdin_write(const char* data) {
    ssize_t bytesWritten = write(PARENT_WRITE_FD, data, strlen(data));
    if (bytesWritten > 0 && data[strlen(data) - 1] != '\n') {
        write(PARENT_WRITE_FD, "\n", 1);
    }
    return bytesWritten >= 0 ? 1 : 0;
}

int scan_set_variant(const char* variant) {
    // Implementuj ustawienie wariantu warcabów
    std::string command = "set-param name variant value ";
    command += variant;
    return scan_stdin_write(command.c_str());
}

const char* scan_get_position_format(void) {
    // Zwróć przykładowy format pozycji warcabowej
    return "W:W31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50:B1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20";
}

} // extern "C"

// Implementacja Hub protocol loop
static void hub_loop_bridge() {
    Game game;
    Search_Input si;

    while (true) {
        std::string line = hub::read();
        hub::Scanner scan(line);

        if (scan.eos()) {
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
            if (move != move::None) hub::add_pair(line, "move", move::to_hub(move, p0));
            if (answer != move::None) hub::add_pair(line, "ponder", move::to_hub(answer, p1));
            hub::write(line);

            si.init(); // reset level

        } else if (command == "hub") {
            std::string line = "id";
            hub::add_pair(line, "name", "Scan");
            hub::add_pair(line, "version", "3.1");
            hub::add_pair(line, "author", "Fabien Letouzey");
            hub::write(line);

            // Parametry silnika
            std::string param_line = "param";
            hub::add_pair(param_line, "name", "variant");
            hub::add_pair(param_line, "value", var::get("variant"));
            hub::add_pair(param_line, "type", "enum");
            hub::add_pair(param_line, "values", "normal killer bt frisian losing");
            hub::write(param_line);

            hub::write("wait");

        } else if (command == "init") {
            init_scan_low();
            hub::write("ready");

        } else if (command == "level") {
            int depth = -1;
            double move_time = -1.0;
            int64 nodes = -1;

            while (!scan.eos()) {
                auto p = scan.get_pair();

                if (p.name == "depth") {
                    depth = std::stoi(p.value);
                } else if (p.name == "move-time") {
                    move_time = std::stod(p.value);
                } else if (p.name == "nodes") {
                    nodes = std::stoll(p.value);
                }
            }

            if (depth >= 0) si.depth = Depth(depth);
            if (move_time >= 0.0) si.time = move_time;
            if (nodes >= 0) si.nodes = nodes;

        } else if (command == "new-game") {
            // Wyczyść tablice transpozycji
            // G_TT.clear(); // jeśli istnieje

        } else if (command == "ping") {
            hub::write("pong");

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

            // Ustaw pozycję
            try {
                Pos hub_pos = pos_from_hub(pos);
                game.init(hub_pos);
            } catch (const Bad_Input &) {
                hub::error("bad position");
                continue;
            }

            // Wykonaj ruchy
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
                }
            }

            si.init(); // reset level

        } else if (command == "quit") {
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

            var::set(name, value);
            var::update();

        } else if (command == "stop") {
            // Zatrzymaj wyszukiwanie - obsługiwane podczas search

        } else {
            hub::error("bad command");
        }
    }
}

static void init_scan_low() {
    bit::init();
    // if (var::Book) book::init(); // jeśli istnieje
    // if (var::BB) bb::init(); // jeśli istnieje

    // eval_init(); // jeśli istnieje
    // G_TT.set_size(var::TT_Size); // jeśli istnieje
}