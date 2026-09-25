#define _DARWIN_C_SOURCE
#include <sys/ioctl.h>
#include <sys/poll.h>
#include <sys/wait.h>
#include <util.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <errno.h>

/* Feasibility only: never packaged. The production guardian owns durable leases. */
int main(int argc, char **argv) {
  if (argc < 2) return 2;
  signal(SIGPIPE, SIG_IGN);
  int terminal;
  struct winsize dimensions = { .ws_row = 24, .ws_col = 80 };
  pid_t child = forkpty(&terminal, NULL, NULL, &dimensions);
  if (child < 0) return 3;
  if (!child) {
    for (int fd = 3; fd < 1024; fd++) close(fd);
    execv(argv[1], argv + 1); _exit(127);
  }
  int status = 0, eof = 0;
  struct pollfd inputs[3] = {{.fd = 0, .events = POLLIN | POLLHUP}, {.fd = 3, .events = POLLIN | POLLHUP}, {.fd = terminal, .events = POLLIN | POLLHUP}};
  for (;;) {
    int ready = poll(inputs, 3, 100);
    if (ready < 0 && errno != EINTR) { status = 1; break; }
    if (inputs[0].revents) {
      char control[16]; ssize_t count = read(0, control, sizeof(control));
      if (count <= 0 || control[0] == 'X') break;
      if (control[0] == 'R') { dimensions.ws_row = 40; dimensions.ws_col = 120; ioctl(terminal, TIOCSWINSZ, &dimensions); }
    }
    if (inputs[1].revents) {
      char input[4096]; ssize_t count = read(3, input, sizeof(input));
      if (count <= 0) break;
      if (write(terminal, input, count) != count) { status = 1; break; }
    }
    if (!eof && inputs[2].revents) {
      char output[4096]; ssize_t count = read(terminal, output, sizeof(output));
      if (count <= 0) { eof = 1; inputs[2].fd = -1; }
      else if (write(1, output, count) != count) { status = 1; break; }
    }
    if (waitpid(child, &status, WNOHANG) == child) { child = 0; break; }
  }
  if (child) { kill(-child, SIGKILL); waitpid(child, &status, 0); }
  close(terminal);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
