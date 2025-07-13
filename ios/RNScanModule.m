#import "RNScanModule.h"
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <pthread.h>

#include "scan_bridge.h"

@implementation RNScanModule {
    pthread_t engineThread;
    pthread_t listenerThread;
    bool engineRunning;
    bool listenerRunning;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"scan-output", @"scan-analyzed-output"];
}

- (instancetype)init {
    self = [super init];
    if (self) {
        engineRunning = false;
        listenerRunning = false;
    }
    return self;
}

void *scanEngineThreadFunction(void *arg) {
    scan_main();
    return NULL;
}

void *scanListenerThreadFunction(void *arg) {
    RNScanModule *module = (__bridge RNScanModule *)arg;
    
    while ([module isListenerRunning]) {
        const char *output = scan_stdout_read();
        if (output != NULL) {
            NSString *outputString = [NSString stringWithUTF8String:output];
            if (outputString.length > 0) {
                [module processEngineOutput:outputString];
            }
        }
        [NSThread sleepForTimeInterval:0.01];
    }
    
    return NULL;
}

- (void)processEngineOutput:(NSString *)output {
    if (output.length == 0) return;
    
    NSArray *lines = [output componentsSeparatedByString:@"\n"];
    for (NSString *line in lines) {
        if (line.length == 0) continue;
        
        [self sendEventWithName:@"scan-output" body:line];
        
        if ([line hasPrefix:@"done"]) {
            [self processDoneOutput:line];
        } else if ([line hasPrefix:@"info"]) {
            [self processInfoOutput:line];
        }
    }
}

- (void)processDoneOutput:(NSString *)line {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"done";
    
    NSArray *parts = [line componentsSeparatedByString:@" "];
    for (NSInteger i = 0; i < parts.count - 1; i++) {
        if ([parts[i] isEqualToString:@"move"]) {
            result[@"move"] = parts[i + 1];
        } else if ([parts[i] isEqualToString:@"ponder"]) {
            result[@"ponder"] = parts[i + 1];
        }
    }
    
    [self sendEventWithName:@"scan-analyzed-output" body:result];
}

- (void)processInfoOutput:(NSString *)line {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"info";
    result[@"line"] = line;
    
    [self sendEventWithName:@"scan-analyzed-output" body:result];
}

- (bool)isListenerRunning {
    return listenerRunning;
}

RCT_EXPORT_METHOD(initEngine:(NSString *)variant
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    if (engineRunning) {
        resolve(@(YES));
        return;
    }
    
    scan_init();
    
    if (variant && variant.length > 0) {
        scan_set_variant([variant UTF8String]);
    }
    
    int status = pthread_create(&engineThread, NULL, scanEngineThreadFunction, NULL);
    if (status != 0) {
        NSString *errorMsg = [NSString stringWithFormat:@"Failed to create engine thread: %d", status];
        reject(@"THREAD_ERROR", errorMsg, nil);
        return;
    }
    engineRunning = true;
    
    listenerRunning = true;
    status = pthread_create(&listenerThread, NULL, scanListenerThreadFunction, (__bridge void *)self);
    if (status != 0) {
        NSString *errorMsg = [NSString stringWithFormat:@"Failed to create listener thread: %d", status];
        reject(@"THREAD_ERROR", errorMsg, nil);
        return;
    }
    
    resolve(@(YES));
}

RCT_EXPORT_METHOD(sendCommand:(NSString *)command
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    if (!engineRunning) {
        reject(@"ENGINE_NOT_RUNNING", @"Scan engine is not running", nil);
        return;
    }
    
    const char *cmd = [command UTF8String];
    bool success = scan_stdin_write(cmd);
    
    resolve(@(success));
}

RCT_EXPORT_METHOD(shutdownEngine:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    if (!engineRunning) {
        resolve(@(YES));
        return;
    }
    
    scan_stdin_write("quit\n");
    
    listenerRunning = false;
    
    if (engineRunning) {
        pthread_join(engineThread, NULL);
        engineRunning = false;
    }
    
    if (listenerRunning) {
        pthread_join(listenerThread, NULL);
        listenerRunning = false;
    }
    
    resolve(@(YES));
}

@end