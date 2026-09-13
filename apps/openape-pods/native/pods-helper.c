#define _DARWIN_C_SOURCE
#include <sys/stat.h>
#include <sys/wait.h>
#include <sys/proc.h>
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
static int group_alive(pid_t group) {
  int size = proc_listpids(PROC_PGRP_ONLY, (uint32_t)group, NULL, 0);
  if (size < 0) fail("Inspect owned group");
  if (!size) return 0;
  size += 32 * (int)sizeof(pid_t);
  pid_t *members = calloc(1, (size_t)size);
  if (!members) fail("Allocate owned group list");
  int actual = proc_listpids(PROC_PGRP_ONLY, (uint32_t)group, members, size);
  if (actual < 0 || actual >= size) fail("Read owned group list");
  int alive = 0;
  for (int index = 0; index < actual / (int)sizeof(pid_t); index++) {
    struct proc_bsdinfo info;
    if (!members[index]) continue;
    int bytes = proc_pidinfo(members[index], PROC_PIDTBSDINFO, 0, &info, sizeof(info));
    if (!bytes && errno == ESRCH) continue;
    if (bytes != sizeof(info)) fail("Inspect owned group member");
    if (info.pbi_pgid == (uint32_t)group && info.pbi_status != SZOMB) alive = 1;
  }
  free(members); return alive;
}
static void signal_group(pid_t child, int signal_number) {
  if (kill(-child, signal_number) == 0 || errno == ESRCH) return;
  if (errno == EPERM && !group_alive(child)) return;
  fail("Signal owned process group");
}
static void terminate_group(pid_t child, int *status) {
  signal_group(child, SIGTERM);
  struct timespec grace = { .tv_sec = 0, .tv_nsec = 200000000 }; nanosleep(&grace, NULL);
  signal_group(child, SIGKILL);
  int64_t deadline = monotonic_ms() + 5000;
  while (group_alive(child)) {
    if (monotonic_ms() > deadline) { errno = ETIMEDOUT; fail("Process group cleanup remains unresolved"); }
    struct timespec pause = { .tv_sec = 0, .tv_nsec = 10000000 }; nanosleep(&pause, NULL);
  }
  while (waitpid(child, status, 0) < 0) if (errno != EINTR) fail("Reap isolated process");
}
struct domain_record {
  pid_t guardian, child;
  unsigned long long guardian_sec, guardian_usec, child_sec, child_usec;
  int closed;
};
static int process_info(pid_t pid, struct proc_bsdinfo *info) {
  int bytes = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, info, sizeof(*info));
  if (!bytes && errno == ESRCH) return 0;
  if (bytes != sizeof(*info)) fail("Inspect process birth identity");
  return 1;
}
static int same_live_process(pid_t pid, unsigned long long sec, unsigned long long usec) {
  if (!pid) return 0;
  struct proc_bsdinfo info;
  return process_info(pid, &info) && info.pbi_start_tvsec == sec && info.pbi_start_tvusec == usec && info.pbi_status != SZOMB;
}
static void write_domain(const char *path, const struct domain_record *record) {
  if (!path) return;
  char staging[PATH_MAX], parent[PATH_MAX];
  if (path[0] != '/' || strlen(path) > PATH_MAX - 40) { errno = EINVAL; fail("Invalid domain record path"); }
  snprintf(staging, sizeof(staging), "%s.stage-%d", path, getpid());
  int fd = open(staging, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) fail("Create domain record");
  if (dprintf(fd, "PODS_DOMAIN_V1 %d %llu %llu %d %llu %llu %d\n", record->guardian, record->guardian_sec, record->guardian_usec, record->child, record->child_sec, record->child_usec, record->closed) < 0 || fsync(fd) < 0) fail("Flush domain record");
  if (close(fd) < 0 || rename(staging, path) < 0) fail("Publish domain record");
  strcpy(parent, path); char *slash = strrchr(parent, '/'); if (slash == parent) slash[1] = '\0'; else *slash = '\0';
  int directory = open(parent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directory < 0 || fsync(directory) < 0 || close(directory) < 0) fail("Flush domain directory");
}
static int read_domain(const char *path, struct domain_record *record) {
  int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0 && errno == ENOENT) return 0;
  if (fd < 0) fail("Read domain record");
  struct stat status;
  if (fstat(fd, &status) < 0 || !S_ISREG(status.st_mode) || status.st_uid != getuid() || (status.st_mode & 077) || status.st_size < 1 || status.st_size > 1000) { errno = EINVAL; fail("Invalid private domain record"); }
  char body[1024]; ssize_t size = read(fd, body, sizeof(body) - 1); close(fd);
  if (size != status.st_size) { errno = EIO; fail("Incomplete domain record"); }
  body[size] = '\0'; int end = 0;
  if (sscanf(body, "PODS_DOMAIN_V1 %d %llu %llu %d %llu %llu %d%n", &record->guardian, &record->guardian_sec, &record->guardian_usec, &record->child, &record->child_sec, &record->child_usec, &record->closed, &end) != 7 || body[end] != '\n' || body[end + 1] != '\0' || record->guardian < 2 || record->child < 0 || record->guardian_sec == 0 || (record->child && !record->child_sec) || (record->closed != 0 && record->closed != 1)) { errno = EINVAL; fail("Malformed domain identity"); }
  return 1;
}
static int inspect_domain(const char *path) {
  for (int attempt = 0; attempt < 3; attempt++) {
    struct domain_record record, latest; memset(&record, 0, sizeof(record)); memset(&latest, 0, sizeof(latest));
    if (!read_domain(path, &record)) { puts("{\"quiescent\":false,\"reason\":\"registration-missing\"}"); return 0; }
    if (record.closed) { puts("{\"quiescent\":true,\"reason\":\"confirmed-closed\"}"); return 0; }
    if (same_live_process(record.guardian, record.guardian_sec, record.guardian_usec) || same_live_process(record.child, record.child_sec, record.child_usec) || (record.child && group_alive(record.child))) {
      puts("{\"quiescent\":false,\"reason\":\"previous-domain-still-present\"}"); return 0;
    }
    if (!read_domain(path, &latest) || memcmp(&record, &latest, sizeof(record))) continue;
    puts("{\"quiescent\":true,\"reason\":\"previous-processes-gone\"}"); return 0;
  }
  puts("{\"quiescent\":false,\"reason\":\"registration-changing\"}"); return 0;
}
static int lease_open(void) {
  struct pollfd lease = { .fd = STDIN_FILENO, .events = POLLIN | POLLHUP };
  int ready = poll(&lease, 1, 0);
  if (ready < 0) fail("Inspect startup lease");
  if (!ready) return 1;
  char bytes[128]; ssize_t count = read(STDIN_FILENO, bytes, sizeof(bytes));
  if (count <= 0) return 0;
  for (ssize_t i = 0; i < count; i++) if (bytes[i] != 'H') return 0;
  return 1;
}
static int supervise(char **command, const char *record_path) {
  signal(SIGPIPE, SIG_IGN);
  struct domain_record record; memset(&record, 0, sizeof(record));
  struct proc_bsdinfo guardian_info;
  if (!process_info(getpid(), &guardian_info)) fail("Missing guardian identity");
  record.guardian = getpid(); record.guardian_sec = guardian_info.pbi_start_tvsec; record.guardian_usec = guardian_info.pbi_start_tvusec;
  write_domain(record_path, &record);
  if (!lease_open()) { record.closed = 1; write_domain(record_path, &record); return 125; }
  int permission[2]; if (pipe(permission) < 0) fail("Create execution gate");
  int readiness[2];
  if (pipe(readiness) < 0) fail("Create process registration pipe");
  pid_t child = fork();
  if (child < 0) fail("Start isolated process");
  if (!child) {
    close(readiness[0]); close(permission[1]);
    if (setsid() < 0) fail("Own process group");
    if (write(readiness[1], "R", 1) != 1) fail("Register process group");
    close(readiness[1]);
    char approved;
    if (read(permission[0], &approved, 1) != 1 || approved != 'G') _exit(125);
    close(permission[0]);
    int input = open("/dev/null", O_RDONLY);
    if (input < 0 || dup2(input, STDIN_FILENO) < 0) fail("Close inherited input");
    close_descriptors(4);
    execv(command[0], command); fail("Execute isolated process");
  }
  close(readiness[1]); close(permission[0]);
  char registered;
  if (read(readiness[0], &registered, 1) != 1 || registered != 'R') {
    kill(child, SIGKILL); waitpid(child, NULL, 0); fail("Process group registration failed");
  }
  close(readiness[0]);
  struct proc_bsdinfo child_info;
  if (!process_info(child, &child_info)) fail("Missing child identity");
  record.child = child; record.child_sec = child_info.pbi_start_tvsec; record.child_usec = child_info.pbi_start_tvusec;
  write_domain(record_path, &record);
  if (!lease_open()) { close(permission[1]); int status; terminate_group(child, &status); record.closed = 1; write_domain(record_path, &record); return 125; }
  if (write(permission[1], "G", 1) != 1) fail("Open execution gate");
  close(permission[1]);
  close(3);
  dprintf(4, "{\"pid\":%d}\n", child);
  int status = 0; int64_t deadline = monotonic_ms() + 30000;
  for (;;) {
    siginfo_t exited; memset(&exited, 0, sizeof(exited));
    if (waitid(P_PID, (id_t)child, &exited, WEXITED | WNOHANG | WNOWAIT) < 0) { if (errno == EINTR) continue; fail("Inspect isolated process"); }
    if (exited.si_pid == child) { terminate_group(child, &status); break; }
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
      record.closed = 1; write_domain(record_path, &record);
      dprintf(4, "{\"stopped\":true}\n"); close(4); return 125;
    }
  }
  record.closed = 1; write_domain(record_path, &record);
  close(4);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
int main(int argc, char **argv) {
  if (argc == 5 && !strcmp(argv[1], "capture")) { close_descriptors(3); capture(argv[2], argv[3], argv[4]); return 0; }
  if (argc >= 3 && !strcmp(argv[1], "supervise") && argv[2][0] == '/') return supervise(argv + 2, NULL);
  if (argc >= 4 && !strcmp(argv[1], "supervise-record") && argv[2][0] == '/' && argv[3][0] == '/') return supervise(argv + 3, argv[2]);
  if (argc == 3 && !strcmp(argv[1], "inspect-domain") && argv[2][0] == '/') { close_descriptors(3); return inspect_domain(argv[2]); }
  fprintf(stderr, "Expected capture SOURCE STAGING LIMIT or supervise ABSOLUTE_EXECUTABLE ARGS\n"); return 2;
}
