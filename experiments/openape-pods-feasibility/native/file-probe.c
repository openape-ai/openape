#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    fprintf(stderr, "NATIVE_STARTED pid=%d ppid=%d\n", getpid(), getppid());
    if (argc != 2) {
        fprintf(stderr, "Expected one synthetic file path\n");
        return 2;
    }
    FILE *file = fopen(argv[1], "r");
    if (file == NULL) {
        fprintf(stderr, "fopen: %s\n", strerror(errno));
        return 1;
    }
    char buffer[256];
    size_t count = fread(buffer, 1, sizeof(buffer), file);
    int failed = ferror(file);
    fclose(file);
    if (failed) {
        fprintf(stderr, "fread failed\n");
        return 1;
    }
    return fwrite(buffer, 1, count, stdout) == count ? 0 : 1;
}
