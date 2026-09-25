#define _DARWIN_C_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(void) {
  pid_t child = fork();
  if (child < 0) { printf("FORK_DENIED %d\n", errno); return 0; }
  if (child) { printf("DETACHED_PID %d\n", child); fflush(stdout); usleep(500000); return 0; }
  if (setsid() < 0) return 2;
  signal(SIGTERM, SIG_IGN);
  close(0); close(1); close(2); close(3); close(4);
  sleep(20);
  return 0;
}
