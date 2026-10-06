#import <Foundation/Foundation.h>
#include <arpa/inet.h>
#include <errno.h>
#include <stdio.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc < 2) return 2;
        fprintf(stderr, "HELPER_STARTED pid=%d ppid=%d\n", getpid(), getppid());
        NSString *operation = @(argv[1]);
        NSString *shared = [NSHomeDirectory() stringByAppendingPathComponent:@"pods-m0a-synthetic.txt"];
        if (([operation hasSuffix:@"shared"] || [operation isEqualToString:@"cleanup"]) &&
            ![NSHomeDirectory() containsString:@"/Library/Containers/ai.openape.pods.m0a."]) return 2;
        int result = 0;
        errno = 0;
        if ([operation isEqualToString:@"write-shared"]) {
            FILE *file = fopen(shared.fileSystemRepresentation, "w");
            if (file == NULL) result = -1;
            else { fputs("SYNTHETIC_POD_A_ONLY", file); result = fclose(file); }
        } else if ([operation isEqualToString:@"read-shared"] || [operation isEqualToString:@"read-outside"]) {
            if ([operation isEqualToString:@"read-outside"] && argc != 3) return 2;
            const char *path = [operation isEqualToString:@"read-shared"] ? shared.fileSystemRepresentation : argv[2];
            FILE *file = fopen(path, "r");
            if (file == NULL) result = -1;
            else {
                char data[64] = {0};
                size_t length = fread(data, 1, sizeof(data) - 1, file);
                result = ferror(file) ? -1 : 0;
                fclose(file);
                fwrite(data, 1, length, stdout);
                putchar('\n');
            }
        } else if ([operation isEqualToString:@"cleanup"]) {
            result = unlink(shared.fileSystemRepresentation);
        } else if ([operation isEqualToString:@"network"]) {
            if (argc != 3) return 2;
            int descriptor = socket(AF_INET, SOCK_STREAM, 0);
            if (descriptor < 0) result = -1;
            else {
                struct timeval timeout = {.tv_sec = 2, .tv_usec = 0};
                setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
                struct sockaddr_in address = {.sin_family = AF_INET, .sin_port = htons((unsigned short)atoi(argv[2]))};
                inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
                result = connect(descriptor, (struct sockaddr *)&address, sizeof(address));
                int saved = errno;
                close(descriptor);
                errno = saved;
            }
        } else if ([operation isEqualToString:@"unassigned-executable"]) {
            pid_t child = fork();
            if (child == 0) { execl("/usr/bin/true", "true", NULL); _exit(126); }
            if (child < 0) result = -1;
            else { int status = 0; waitpid(child, &status, 0); result = WIFEXITED(status) ? WEXITSTATUS(status) : -1; }
        } else return 2;
        int saved = errno;
        NSDictionary *record = @{@"operation": operation, @"home": NSHomeDirectory(), @"result": @(result), @"errno": @(saved)};
        NSData *json = [NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys error:NULL];
        fwrite(json.bytes, 1, json.length, stdout);
        putchar('\n');
        return result == 0 ? 0 : 1;
    }
}
