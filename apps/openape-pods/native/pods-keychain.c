#include <stdbool.h>
#include <Security/Security.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  const char *service = "OpenApe Pods Safe Storage";
  const char *account = "OpenApe Pods";
  UInt32 length = 0;
  void *password = NULL;
  // The existing login-keychain item is read only; an unavailable ACL fails
  // without displaying a system dialog or creating another encryption key.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  OSStatus status = SecKeychainSetUserInteractionAllowed(false);
  if (status == errSecSuccess) status = SecKeychainFindGenericPassword(NULL,
      (UInt32)strlen(service), service, (UInt32)strlen(account), account,
      &length, &password, NULL);
  if (status != errSecSuccess || !length || length > 1024) {
    fprintf(stderr, "Existing Pods identity key is unavailable (%d)\n", (int)status);
    return 1;
  }
  size_t written = fwrite(password, 1, length, stdout);
  memset(password, 0, length);
  SecKeychainItemFreeContent(NULL, password);
#pragma clang diagnostic pop
  return written == length ? 0 : 1;
}
