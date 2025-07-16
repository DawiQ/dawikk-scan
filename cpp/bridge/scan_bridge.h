#ifndef SCAN_BRIDGE_H
#define SCAN_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

// Public API functions
int scan_init(void);
int scan_main(void);
const char* scan_stdout_read(void);
int scan_stdin_write(const char* data);
void scan_shutdown(void);

#ifdef __cplusplus
}
#endif

#endif // SCAN_BRIDGE_H