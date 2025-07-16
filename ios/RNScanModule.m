// RNScanModule.m
#import "RNScanModule.h"
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <pthread.h>

// Import the C++ bridge header
#include "scan_bridge.h"

@implementation RNScanModule {
    pthread_t engineThread;
    pthread_t listenerThread;
    bool engineRunning;
    bool listenerRunning;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
    return @[@"scan-output", @"scan-analyzed-output"];
}

- (instancetype)init
{
    self = [super init];
    if (self) {
        engineRunning = false;
        listenerRunning = false;
    }
    return self;
}

void *engineThreadFunction(void *arg)
{
    // Call the C++ function to start the Scan engine
    scan_main();
    return NULL;
}

void *listenerThreadFunction(void *arg)
{
    RNScanModule *module = (__bridge RNScanModule *)arg;
    
    while ([module isListenerRunning]) {
        const char *output = scan_stdout_read();
        if (output != NULL) {
            NSString *outputString = [NSString stringWithUTF8String:output];
            if (outputString.length > 0) {
                [module processEngineOutput:outputString];
            }
        }
        // Add a small delay to avoid high CPU usage
        [NSThread sleepForTimeInterval:0.01];
    }
    
    return NULL;
}

- (void)processEngineOutput:(NSString *)output
{
    if (output.length == 0) return;
    
    // Process the output lines
    NSArray *lines = [output componentsSeparatedByString:@"\n"];
    for (NSString *line in lines) {
        if (line.length == 0) continue;
        
        // Send raw output to JavaScript
        [self sendEventWithName:@"scan-output" body:line];
        
        // Process HUB protocol output
        if ([line hasPrefix:@"info"]) {
            [self sendAnalyzedOutput:line];
        } else if ([line hasPrefix:@"done"]) {
            [self sendBestMoveOutput:line];
        }
    }
}

- (void)sendBestMoveOutput:(NSString *)line
{
    // Format: "done move=32-28 ponder=19-23"
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"bestmove";
    
    // Parse HUB format: key=value pairs
    NSArray *parts = [line componentsSeparatedByString:@" "];
    for (NSString *part in parts) {
        if ([part containsString:@"="]) {
            NSArray *keyValue = [part componentsSeparatedByString:@"="];
            if (keyValue.count == 2) {
                NSString *key = keyValue[0];
                NSString *value = keyValue[1];
                
                if ([key isEqualToString:@"move"]) {
                    result[@"move"] = value;
                } else if ([key isEqualToString:@"ponder"]) {
                    result[@"ponder"] = value;
                }
            }
        }
    }
    
    [self sendEventWithName:@"scan-analyzed-output" body:result];
}

- (void)sendAnalyzedOutput:(NSString *)line
{
    // Parse HUB info line: info depth=5 score=0.15 nodes=1000 time=0.100 nps=10000.0 pv="32-28 19-23"
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"info";
    
    // Parse HUB format: key=value pairs
    NSArray *parts = [line componentsSeparatedByString:@" "];
    for (int i = 1; i < parts.count; i++) { // Skip "info"
        NSString *part = parts[i];
        
        if ([part containsString:@"="]) {
            NSArray *keyValue = [part componentsSeparatedByString:@"="];
            if (keyValue.count == 2) {
                NSString *key = keyValue[0];
                NSString *value = keyValue[1];
                
                if ([key isEqualToString:@"depth"]) {
                    result[@"depth"] = @([value intValue]);
                } else if ([key isEqualToString:@"score"]) {
                    result[@"score"] = @([value floatValue]);
                } else if ([key isEqualToString:@"nodes"]) {
                    result[@"nodes"] = @([value longLongValue]);
                } else if ([key isEqualToString:@"time"]) {
                    result[@"time"] = @([value floatValue]);
                } else if ([key isEqualToString:@"nps"]) {
                    result[@"nps"] = @([value floatValue]);
                } else if ([key isEqualToString:@"pv"]) {
                    // Remove quotes if present
                    NSString *cleanValue = [value stringByReplacingOccurrencesOfString:@"\"" withString:@""];
                    result[@"line"] = cleanValue;
                    
                    // Extract first move as best move
                    NSArray *moves = [cleanValue componentsSeparatedByString:@" "];
                    if (moves.count > 0) {
                        result[@"bestMove"] = moves[0];
                    }
                }
            }
        }
    }
    
    [self sendEventWithName:@"scan-analyzed-output" body:result];
}

- (bool)isListenerRunning
{
    return listenerRunning;
}

RCT_EXPORT_METHOD(initEngine:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    if (engineRunning) {
        resolve(@(YES));
        return;
    }
    
    // Initialize the Scan engine
    scan_init();
    
    // Start the engine thread
    int status = pthread_create(&engineThread, NULL, engineThreadFunction, NULL);
    if (status != 0) {
        NSString *errorMsg = [NSString stringWithFormat:@"Failed to create engine thread: %d", status];
        reject(@"THREAD_ERROR", errorMsg, nil);
        return;
    }
    engineRunning = true;
    
    // Start the listener thread
    listenerRunning = true;
    status = pthread_create(&listenerThread, NULL, listenerThreadFunction, (__bridge void *)self);
    if (status != 0) {
        NSString *errorMsg = [NSString stringWithFormat:@"Failed to create listener thread: %d", status];
        reject(@"THREAD_ERROR", errorMsg, nil);
        return;
    }
    
    resolve(@(YES));
}

RCT_EXPORT_METHOD(sendCommand:(NSString *)command
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    if (!engineRunning) {
        reject(@"ENGINE_NOT_RUNNING", @"Scan engine is not running", nil);
        return;
    }
    
    const char *cmd = [command UTF8String];
    bool success = scan_stdin_write(cmd);
    
    if (success) {
        resolve(@(YES));
    } else {
        reject(@"COMMAND_FAILED", @"Failed to send command to Scan", nil);
    }
}

RCT_EXPORT_METHOD(shutdownEngine:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    if (!engineRunning) {
        resolve(@(YES));
        return;
    }
    
    // Send the quit command to Scan
    scan_stdin_write("quit");
    
    // Stop the listener thread
    listenerRunning = false;
    
    // Wait for threads to finish
    if (engineRunning) {
        pthread_join(engineThread, NULL);
        engineRunning = false;
    }
    
    if (listenerRunning) {
        pthread_join(listenerThread, NULL);
        listenerRunning = false;
    }
    
    // Clean up C++ bridge
    scan_shutdown();
    
    resolve(@(YES));
}

- (void)invalidate
{
    [self shutdownEngine:^(id result) {} rejecter:^(NSString *code, NSString *message, NSError *error) {}];
    [super invalidate];
}

@end