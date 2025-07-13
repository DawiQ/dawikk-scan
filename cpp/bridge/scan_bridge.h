#ifndef SCAN_BRIDGE_H
#define SCAN_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

// Public API functions - podobne do stockfish_bridge.h ale dla Scan
int scan_init(void);
int scan_main(void);
const char* scan_stdout_read(void);
int scan_stdin_write(const char* data);

// Dodatkowe funkcje specyficzne dla warcabów
int scan_set_variant(const char* variant); // "normal", "frisian", etc.
const char* scan_get_position_format(void); // Zwraca format pozycji warcabowej

#ifdef __cplusplus
}
#endif

#endif // SCAN_BRIDGE_H