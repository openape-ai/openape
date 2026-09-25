#include <sys/ioctl.h>
#include <util.h>

#define TERMINAL_BUFFER_SIZE 65536
struct terminal_io {
  int master;
  unsigned char input[TERMINAL_BUFFER_SIZE], output[TERMINAL_BUFFER_SIZE], dimensions[4];
  size_t input_size, output_size, dimensions_size;
  int ended;
};
static int nonblocking(int fd) {
  int flags = fcntl(fd, F_GETFL);
  return flags < 0 ? -1 : fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}
static int terminal_write(int fd, unsigned char *bytes, size_t *size) {
  if (!*size) return 0;
  ssize_t written = write(fd, bytes, *size);
  if (written < 0) return errno == EAGAIN || errno == EINTR ? 0 : -1;
  memmove(bytes, bytes + written, *size - (size_t)written); *size -= (size_t)written;
  return 0;
}
static int terminal_read(int fd, unsigned char *bytes, size_t *size, size_t limit) {
  if (*size == limit) return 0;
  ssize_t count = read(fd, bytes + *size, limit - *size);
  if (count < 0) return errno == EAGAIN || errno == EINTR ? 0 : -1;
  if (!count) { errno = 0; return -1; }
  *size += (size_t)count;
  return 0;
}
static int terminal_pump(struct terminal_io *io) {
  if (terminal_write(io->master, io->input, &io->input_size) < 0 || terminal_write(STDOUT_FILENO, io->output, &io->output_size) < 0) return -1;
  if (terminal_read(3, io->input, &io->input_size, sizeof(io->input)) < 0) return -1;
  if (terminal_read(5, io->dimensions, &io->dimensions_size, sizeof(io->dimensions)) < 0) return -1;
  if (io->dimensions_size == 4) {
    unsigned int columns = io->dimensions[0] | (io->dimensions[1] << 8);
    unsigned int rows = io->dimensions[2] | (io->dimensions[3] << 8);
    if (columns < 20 || columns > 500 || rows < 5 || rows > 300) return -1;
    struct winsize dimensions = { .ws_col = (unsigned short)columns, .ws_row = (unsigned short)rows };
    if (ioctl(io->master, TIOCSWINSZ, &dimensions) < 0) return -1;
    io->dimensions_size = 0;
  }
  if (!io->ended && terminal_read(io->master, io->output, &io->output_size, sizeof(io->output)) < 0) {
    if (errno != EIO && errno != 0) return -1;
    io->ended = 1;
  }
  return terminal_write(STDOUT_FILENO, io->output, &io->output_size);
}
static int terminal_drain(struct terminal_io *io) {
  int64_t deadline = monotonic_ms() + 1000;
  do {
    if (!io->ended && io->output_size < sizeof(io->output)) {
      ssize_t count = read(io->master, io->output + io->output_size, sizeof(io->output) - io->output_size);
      if (count > 0) io->output_size += (size_t)count;
      else if (!count || (count < 0 && errno == EIO)) io->ended = 1;
      else if (errno != EAGAIN && errno != EINTR) return -1;
    }
    if (terminal_write(STDOUT_FILENO, io->output, &io->output_size) < 0) return -1;
    if (io->ended && !io->output_size) return 0;
    struct timespec pause = { .tv_sec = 0, .tv_nsec = 1000000 }; nanosleep(&pause, NULL);
  } while (monotonic_ms() < deadline);
  return -1;
}
