#define _DARWIN_C_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

static volatile sig_atomic_t interrupted = 0;
static void interrupt(int signal_number) { (void)signal_number; interrupted = 1; }
int main(void) {
  struct termios settings;
  struct winsize size;
  if (tcgetattr(0, &settings) < 0 || ioctl(0, TIOCGWINSZ, &size) < 0) return 2;
  printf("TTY %d %d %d SIZE %d %d\n", isatty(0), isatty(1), isatty(2), size.ws_col, size.ws_row);
  settings.c_lflag &= ~(ECHO); tcsetattr(0, TCSANOW, &settings);
  puts("PASSWORD_READY"); fflush(stdout);
  char input[256];
  if (!fgets(input, sizeof(input), stdin)) return 3;
  printf("PASSWORD_MATCH %d\n", strcmp(input, "SYNTHETIC_ä🔒\n") == 0);
  ioctl(0, TIOCGWINSZ, &size); printf("RESIZED %d %d\n", size.ws_col, size.ws_row);
  signal(SIGINT, interrupt); puts("INTERRUPT_READY"); fflush(stdout);
  while (!interrupted) pause();
  puts("INTERRUPTED"); fflush(stdout);
  return 0;
}
