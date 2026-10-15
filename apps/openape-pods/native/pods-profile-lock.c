#define _DARWIN_C_SOURCE
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>

int main(int argc, char **argv) {
  if (argc != 2 || argv[1][0] != '/') return 2;
  int fd = open(argv[1], O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
  struct stat info;
  if (fd < 0 || fstat(fd, &info) || !S_ISREG(info.st_mode) || info.st_uid != getuid() || (info.st_mode & 077)) return 2;
  if (flock(fd, LOCK_EX | LOCK_NB)) return 3;
  puts("locked"); fflush(stdout);
  char buffer[16];
  while (read(STDIN_FILENO, buffer, sizeof(buffer)) > 0) {}
  close(fd);
  return 0;
}
