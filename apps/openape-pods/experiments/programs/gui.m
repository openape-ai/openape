#import <Cocoa/Cocoa.h>
#include <unistd.h>
int main(void) {
  @autoreleasepool {
    NSApplication *app = [NSApplication sharedApplication];
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 480, 200)
      styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
    [window setTitle:@"OpenApe Pods — Synthetic GUI boundary probe"];
    [window center]; [window makeKeyAndOrderFront:nil];
    puts("GUI_READY"); fflush(stdout);
    [NSTimer scheduledTimerWithTimeInterval:2 repeats:NO block:^(NSTimer *timer) { (void)timer; [app terminate:nil]; }];
    [app run];
  }
  return 0;
}
