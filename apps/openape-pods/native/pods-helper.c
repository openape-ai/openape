#define _DARWIN_C_SOURCE
#include <sys/stat.h>
#include <sys/wait.h>
#include <sys/poll.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
#include <time.h>
#include <libproc.h>

static void fail(const char *message) { perror(message); exit(1); }
static void close_descriptors(int first) {
  int size = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, NULL, 0);
  if (size <= 0) fail("Inspect inherited descriptors");
  struct proc_fdinfo *descriptors = malloc((size_t)size);
  if (!descriptors) fail("Allocate descriptor list");
  int actual = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, descriptors, size);
  if (actual <= 0 || actual > size) fail("Read inherited descriptors");
  for (int index = 0; index < actual / (int)sizeof(*descriptors); index++) {
    if (descriptors[index].proc_fd >= first) close(descriptors[index].proc_fd);
  }
  free(descriptors);
}
static int open_source(const char *path) {
  if (path[0] != '/' || strlen(path) >= PATH_MAX) { errno = EINVAL; fail("Source must be absolute"); }
  char copy[PATH_MAX]; strcpy(copy, path + 1);
  int directory = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (directory < 0) fail("Open source root");
  char *state = NULL;
  char *part = strtok_r(copy, "/", &state);
  if (!part) { errno = EINVAL; fail("Missing source file"); }
  while (part) {
    if (!strcmp(part, ".") || !strcmp(part, "..")) { errno = EINVAL; fail("Invalid source component"); }
    char *next = strtok_r(NULL, "/", &state);
    int descriptor = openat(directory, part, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | (next ? O_DIRECTORY : O_NONBLOCK));
    if (descriptor < 0) fail("Open source component");
    close(directory); directory = descriptor; part = next;
  }
  return directory;
}
static int same_version(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino && left->st_size == right->st_size &&
    left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec && left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec &&
    left->st_ctimespec.tv_sec == right->st_ctimespec.tv_sec && left->st_ctimespec.tv_nsec == right->st_ctimespec.tv_nsec;
}
static void capture(const char *source, const char *destination, const char *limit_text) {
  char *end = NULL; errno = 0;
  long long limit = strtoll(limit_text, &end, 10);
  if (errno || !end || *end || limit < 1 || limit > 104857600) { errno = EINVAL; fail("Invalid snapshot limit"); }
  int input = open_source(source);
  struct stat before, after, current;
  if (fstat(input, &before) < 0) fail("Inspect source");
  if (!S_ISREG(before.st_mode) || before.st_size > limit) { errno = EINVAL; fail("Source is not a bounded regular file"); }
  int output = open(destination, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (output < 0) fail("Create staging file");
  char buffer[65536]; ssize_t count; long long total = 0;
  while ((count = read(input, buffer, sizeof(buffer))) > 0) {
    total += count;
    if (total > limit) { errno = EFBIG; fail("Snapshot exceeds limit"); }
    ssize_t written = 0;
    while (written < count) {
      ssize_t result = write(output, buffer + written, (size_t)(count - written));
      if (result < 0) { if (errno == EINTR) continue; fail("Write snapshot"); }
      written += result;
    }
  }
  if (count < 0) fail("Read snapshot");
  if (fstat(input, &after) < 0) fail("Reinspect source");
  int reopened = open_source(source);
  if (fstat(reopened, &current) < 0) fail("Reinspect source path");
  if (!same_version(&before, &after) || !same_version(&after, &current) || total != before.st_size) { errno = ESTALE; fail("Source changed during snapshot"); }
  if (fchmod(output, 0400) < 0 || fsync(output) < 0) fail("Flush snapshot");
  if (close(output) < 0) fail("Close snapshot");
  close(input); close(reopened);
  printf("{\"device\":\"%llu\",\"inode\":\"%llu\",\"size\":%lld,\"mtime\":\"%lld.%09ld\"}\n", (unsigned long long)before.st_dev, (unsigned long long)before.st_ino, total, (long long)before.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec);
}
static int64_t monotonic_ms(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) < 0) fail("Monotonic clock");
  return (int64_t)value.tv_sec * 1000 + value.tv_nsec / 1000000;
}
static void terminate_group(pid_t child, int *status) {
  if (kill(-child, SIGTERM) < 0 && errno != ESRCH) fail("Terminate child group");
  struct timespec grace = { .tv_sec = 0, .tv_nsec = 200000000 }; nanosleep(&grace, NULL);
  pid_t result = waitpid(child, status, WNOHANG);
  if (result == child) return;
  if (result < 0) fail("Inspect terminating child");
  if (kill(-child, SIGKILL) < 0 && errno != ESRCH) fail("Kill child group");
  while (waitpid(child, status, 0) < 0) if (errno != EINTR) fail("Reap isolated process");
}
static int supervise(char **command) {
  signal(SIGPIPE, SIG_IGN);
  int readiness[2];
  if (pipe(readiness) < 0) fail("Create process registration pipe");
  pid_t child = fork();
  if (child < 0) fail("Start isolated process");
  if (!child) {
    close(readiness[0]);
    if (setsid() < 0) fail("Own process group");
    if (write(readiness[1], "R", 1) != 1) fail("Register process group");
    close(readiness[1]);
    int input = open("/dev/null", O_RDONLY);
    if (input < 0 || dup2(input, STDIN_FILENO) < 0) fail("Close inherited input");
    close_descriptors(4);
    execv(command[0], command); fail("Execute isolated process");
  }
  close(readiness[1]);
  char registered;
  if (read(readiness[0], &registered, 1) != 1 || registered != 'R') {
    kill(child, SIGKILL); waitpid(child, NULL, 0); fail("Process group registration failed");
  }
  close(readiness[0]);
  close(3);
  dprintf(4, "{\"pid\":%d}\n", child);
  int status = 0; int64_t deadline = monotonic_ms() + 30000;
  for (;;) {
    pid_t result = waitpid(child, &status, WNOHANG);
    if (result == child) break;
    if (result < 0) { if (errno == EINTR) continue; fail("Wait for isolated process"); }
    struct pollfd lease = { .fd = STDIN_FILENO, .events = POLLIN | POLLHUP };
    int readable = poll(&lease, 1, 100);
    if (readable < 0 && errno != EINTR) fail("Watch supervisor lease");
    int stop = monotonic_ms() > deadline;
    if (readable > 0) {
      char heartbeat[128]; ssize_t count = read(STDIN_FILENO, heartbeat, sizeof(heartbeat));
      if (count <= 0) stop = 1;
      else {
        for (ssize_t index = 0; index < count; index++) if (heartbeat[index] != 'H') stop = 1;
        deadline = monotonic_ms() + 30000;
      }
    }
    if (stop) {
      terminate_group(child, &status);
      dprintf(4, "{\"stopped\":true}\n"); close(4); return 125;
    }
  }
  close(4);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
int main(int argc, char **argv) {
  if (argc == 5 && !strcmp(argv[1], "capture")) { close_descriptors(3); capture(argv[2], argv[3], argv[4]); return 0; }
  if (argc >= 3 && !strcmp(argv[1], "supervise") && argv[2][0] == '/') return supervise(argv + 2);
  fprintf(stderr, "Expected capture SOURCE STAGING LIMIT or supervise ABSOLUTE_EXECUTABLE ARGS\n"); return 2;
}
