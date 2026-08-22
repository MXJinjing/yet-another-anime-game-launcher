#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int is_target_pid(pid_t pid, int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--all") == 0) return 1;
    for (int i = 1; i < argc; ++i)
    {
        if ((pid_t)strtol(argv[i], NULL, 10) == pid) return 1;
    }
    return 0;
}

static void print_tsv_string(CFStringRef value)
{
    if (!value) return;

    CFIndex length = CFStringGetLength(value);
    CFIndex size = CFStringGetMaximumSizeForEncoding(length,
                                                      kCFStringEncodingUTF8) + 1;
    char *buffer = malloc((size_t)size);
    if (!buffer) return;

    if (CFStringGetCString(value, buffer, size, kCFStringEncodingUTF8))
    {
        for (char *cursor = buffer; *cursor; ++cursor)
        {
            if (*cursor == '\t' || *cursor == '\r' || *cursor == '\n')
                *cursor = ' ';
        }
        fputs(buffer, stdout);
    }
    free(buffer);
}

int main(int argc, char **argv)
{
    if (argc < 2) return 0;

    CFArrayRef windows = CGWindowListCopyWindowInfo(kCGWindowListOptionAll,
                                                     kCGNullWindowID);
    if (!windows) return 1;

    CFIndex count = CFArrayGetCount(windows);
    for (CFIndex i = 0; i < count; ++i)
    {
        CFDictionaryRef window = CFArrayGetValueAtIndex(windows, i);
        CFNumberRef pid_number = CFDictionaryGetValue(window, kCGWindowOwnerPID);
        CFNumberRef id_number = CFDictionaryGetValue(window, kCGWindowNumber);
        CFNumberRef layer_number = CFDictionaryGetValue(window, kCGWindowLayer);
        CFNumberRef alpha_number = CFDictionaryGetValue(window, kCGWindowAlpha);
        CFBooleanRef onscreen_value = CFDictionaryGetValue(window,
                                                            kCGWindowIsOnscreen);
        CFDictionaryRef bounds_value = CFDictionaryGetValue(window,
                                                             kCGWindowBounds);
        CFStringRef name = CFDictionaryGetValue(window, kCGWindowName);
        pid_t pid = 0;
        int window_id = 0;
        int layer = -1;
        double alpha = 0;
        CGRect bounds = CGRectZero;
        int onscreen = onscreen_value == kCFBooleanTrue;

        if (!pid_number) continue;
        if (!CFNumberGetValue(pid_number, kCFNumberIntType, &pid)) continue;
        if (!is_target_pid(pid, argc, argv)) continue;
        if (id_number)
            CFNumberGetValue(id_number, kCFNumberIntType, &window_id);
        if (layer_number)
            CFNumberGetValue(layer_number, kCFNumberIntType, &layer);
        if (alpha_number)
            CFNumberGetValue(alpha_number, kCFNumberDoubleType, &alpha);
        if (bounds_value)
            CGRectMakeWithDictionaryRepresentation(bounds_value, &bounds);

        printf("WINDOW\t%d\t%d\t%d\t%d\t%.3f\t%.3f\t%.3f\t%.3f\t%.6f\t",
               pid, window_id, layer, onscreen, bounds.origin.x,
               bounds.origin.y, bounds.size.width, bounds.size.height, alpha);
        print_tsv_string(name);
        putchar('\n');
    }

    CFRelease(windows);
    return 0;
}
