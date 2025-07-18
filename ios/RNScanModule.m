//
//  RNScanModule.m
//  dawikk-scan
//
//  React Native bridge for the Scan draughts engine
//  Implementation of the Scan 3.1 engine integration
//
//  Created by dawikk-scan
//  Copyright © 2024. All rights reserved.
//

#import "RNScanModule.h"
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <pthread.h>

// Import the C++ bridge header
#include "scan_bridge.h"

#pragma mark - Constants Implementation

// Supported draughts variants
NSString * const kScanVariantNormal = @"normal";
NSString * const kScanVariantKiller = @"killer";
NSString * const kScanVariantBT = @"bt";
NSString * const kScanVariantFrisian = @"frisian";
NSString * const kScanVariantLosing = @"losing";

// Event names emitted by this module
NSString * const kScanEventOutput = @"scan-output";
NSString * const kScanEventAnalyzedOutput = @"scan-analyzed-output";

// Standard starting position for international draughts
NSString * const kScanStartingPosition = @"Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww";

#pragma mark - Thread Functions

void *engineThreadFunction(void *arg);
void *listenerThreadFunction(void *arg);

#pragma mark - Implementation

@implementation RNScanModule {
    pthread_t engineThread;
    pthread_t listenerThread;
    BOOL engineRunning;
    BOOL listenerRunning;
    NSString *dataPath;
}

#pragma mark - Module Setup

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
    return @[kScanEventOutput, kScanEventAnalyzedOutput];
}

- (instancetype)init
{
    self = [super init];
    if (self) {
        engineRunning = NO;
        listenerRunning = NO;
        dataPath = nil;
        [self setupDataPath];
    }
    return self;
}

#pragma mark - Property Getters

- (BOOL)isEngineRunning
{
    @synchronized(self) {
        return engineRunning;
    }
}

- (BOOL)isListenerRunning
{
    @synchronized(self) {
        return listenerRunning;
    }
}

- (NSString *)dataPath
{
    @synchronized(self) {
        return dataPath;
    }
}

#pragma mark - Data Path Setup

- (void)setupDataPath
{
    // Get the path to the ScanData bundle
    NSBundle *scanBundle = [NSBundle bundleWithPath:[[NSBundle mainBundle] pathForResource:@"ScanData" ofType:@"bundle"]];
    if (scanBundle) {
        @synchronized(self) {
            dataPath = [scanBundle bundlePath];
        }
        RCTLogInfo(@"ScanData bundle found at: %@", dataPath);
        
        // Set working directory to the data path so Scan can find its files
        const char *path = [dataPath UTF8String];
        if (chdir(path) != 0) {
            RCTLogError(@"Failed to change working directory to: %@", dataPath);
        } else {
            RCTLogInfo(@"Changed working directory to: %@", dataPath);
        }
    } else {
        RCTLogError(@"ScanData bundle not found!");
        // Try to find data in main bundle as fallback
        @synchronized(self) {
            dataPath = [[NSBundle mainBundle] bundlePath];
        }
        RCTLogInfo(@"Using main bundle path as fallback: %@", dataPath);
    }
}

#pragma mark - Thread Functions Implementation

void *engineThreadFunction(void *arg)
{
    @autoreleasepool {
        // Call the C++ function to start the Scan engine
        scan_main();
    }
    return NULL;
}

void *listenerThreadFunction(void *arg)
{
    @autoreleasepool {
        RNScanModule *module = (__bridge RNScanModule *)arg;
        
        while ([module isListenerRunning]) {
            const char *output = scan_stdout_read();
            if (output != NULL && strlen(output) > 0) {
                NSString *outputString = [NSString stringWithUTF8String:output];
                if (outputString.length > 0) {
                    [module processEngineOutput:outputString];
                }
            }
            // Add a small delay to avoid high CPU usage
            [NSThread sleepForTimeInterval:0.01];
        }
    }
    
    return NULL;
}

#pragma mark - Engine Output Processing

- (void)processEngineOutput:(NSString *)output
{
    if (output.length == 0) return;
    
    // Trim whitespace and newlines
    NSString *trimmedOutput = [output stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (trimmedOutput.length == 0) return;
    
    // Send raw output to JavaScript
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventWithName:kScanEventOutput body:trimmedOutput];
    });
    
    // Process HUB protocol output
    if ([trimmedOutput hasPrefix:@"info"]) {
        [self sendAnalyzedOutput:trimmedOutput];
    } else if ([trimmedOutput hasPrefix:@"done"]) {
        [self sendBestMoveOutput:trimmedOutput];
    } else if ([trimmedOutput hasPrefix:@"id"]) {
        [self sendEngineInfo:trimmedOutput];
    } else if ([trimmedOutput hasPrefix:@"param"]) {
        [self sendParameterInfo:trimmedOutput];
    } else if ([trimmedOutput hasPrefix:@"wait"] || 
               [trimmedOutput hasPrefix:@"ready"] || 
               [trimmedOutput hasPrefix:@"pong"]) {
        // These are also important HUB responses
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventWithName:kScanEventAnalyzedOutput body:@{
                @"type": trimmedOutput,
                @"message": trimmedOutput
            }];
        });
    }
}

- (void)sendEngineInfo:(NSString *)line
{
    // Format: "id name=Scan version=3.1 author=\"Fabien Letouzey\" country=France"
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"id";
    
    [self parseHubLine:line intoDictionary:result];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventWithName:kScanEventAnalyzedOutput body:result];
    });
}

- (void)sendParameterInfo:(NSString *)line
{
    // Format: "param name=variant value=normal type=enum values=\"normal killer bt frisian losing\""
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"param";
    
    [self parseHubLine:line intoDictionary:result];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventWithName:kScanEventAnalyzedOutput body:result];
    });
}

- (void)sendBestMoveOutput:(NSString *)line
{
    // Format: "done move=32-28 ponder=19-23"
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"bestmove";
    
    [self parseHubLine:line intoDictionary:result];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventWithName:kScanEventAnalyzedOutput body:result];
    });
}

- (void)sendAnalyzedOutput:(NSString *)line
{
    // Parse HUB info line: info depth=5 score=0.15 nodes=1000 time=0.100 nps=10000.0 pv="32-28 19-23"
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"info";
    
    [self parseHubLine:line intoDictionary:result];
    
    // Convert string values to appropriate types
    if (result[@"depth"]) {
        result[@"depth"] = @([result[@"depth"] intValue]);
    }
    if (result[@"score"]) {
        result[@"score"] = @([result[@"score"] doubleValue]);
    }
    if (result[@"nodes"]) {
        result[@"nodes"] = @([result[@"nodes"] longLongValue]);
    }
    if (result[@"time"]) {
        result[@"time"] = @([result[@"time"] doubleValue]);
    }
    if (result[@"nps"]) {
        result[@"nps"] = @([result[@"nps"] doubleValue]);
    }
    if (result[@"mean-depth"]) {
        result[@"meanDepth"] = @([result[@"mean-depth"] doubleValue]);
        [result removeObjectForKey:@"mean-depth"];
    }
    
    // Handle PV (principal variation)
    if (result[@"pv"]) {
        NSString *pv = result[@"pv"];
        // Remove quotes if present
        NSString *cleanPv = [pv stringByReplacingOccurrencesOfString:@"\"" withString:@""];
        result[@"line"] = cleanPv;
        
        // Extract first move as best move
        NSArray *moves = [cleanPv componentsSeparatedByString:@" "];
        if (moves.count > 0 && [moves[0] length] > 0) {
            result[@"bestMove"] = moves[0];
        }
    }
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventWithName:kScanEventAnalyzedOutput body:result];
    });
}

- (void)parseHubLine:(NSString *)line intoDictionary:(NSMutableDictionary *)dict
{
    // Parse HUB format: command key1=value1 key2=value2 key3="quoted value"
    NSArray *parts = [line componentsSeparatedByString:@" "];
    
    for (int i = 1; i < parts.count; i++) { // Skip first part (command)
        NSString *part = parts[i];
        
        if ([part containsString:@"="]) {
            NSRange equalRange = [part rangeOfString:@"="];
            if (equalRange.location != NSNotFound) {
                NSString *key = [part substringToIndex:equalRange.location];
                NSString *value = [part substringFromIndex:equalRange.location + 1];
                
                // Handle quoted values that might span multiple parts
                if ([value hasPrefix:@"\""] && ![value hasSuffix:@"\""]) {
                    // Multi-word quoted value
                    NSMutableString *fullValue = [NSMutableString stringWithString:value];
                    i++; // Move to next part
                    
                    while (i < parts.count) {
                        [fullValue appendString:@" "];
                        [fullValue appendString:parts[i]];
                        
                        if ([parts[i] hasSuffix:@"\""]) {
                            break;
                        }
                        i++;
                    }
                    value = fullValue;
                }
                
                // Remove quotes if present
                if ([value hasPrefix:@"\""] && [value hasSuffix:@"\""]) {
                    value = [value substringWithRange:NSMakeRange(1, value.length - 2)];
                }
                
                dict[key] = value;
            }
        }
    }
}

#pragma mark - React Native Exported Methods

RCT_EXPORT_METHOD(initEngine:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @synchronized(self) {
        if (engineRunning) {
            resolve(@(YES));
            return;
        }
    }
    
    // Ensure data path is set up
    [self setupDataPath];
    
    // Initialize the Scan engine
    int initResult = scan_init();
    if (initResult != 0) {
        NSString *errorMsg = [NSString stringWithFormat:@"Failed to initialize Scan engine: %d", initResult];
        reject(@"INIT_ERROR", errorMsg, nil);
        return;
    }
    
    // Start the engine thread
    int status = pthread_create(&engineThread, NULL, engineThreadFunction, NULL);
    if (status != 0) {
        NSString *errorMsg = [NSString stringWithFormat:@"Failed to create engine thread: %d", status];
        reject(@"THREAD_ERROR", errorMsg, nil);
        return;
    }
    
    @synchronized(self) {
        engineRunning = YES;
    }
    
    // Start the listener thread
    @synchronized(self) {
        listenerRunning = YES;
    }
    
    status = pthread_create(&listenerThread, NULL, listenerThreadFunction, (__bridge void *)self);
    if (status != 0) {
        NSString *errorMsg = [NSString stringWithFormat:@"Failed to create listener thread: %d", status];
        @synchronized(self) {
            listenerRunning = NO;
        }
        reject(@"THREAD_ERROR", errorMsg, nil);
        return;
    }
    
    RCTLogInfo(@"Scan engine initialized successfully");
    resolve(@(YES));
}

RCT_EXPORT_METHOD(sendCommand:(NSString *)command
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @synchronized(self) {
        if (!engineRunning) {
            reject(@"ENGINE_NOT_RUNNING", @"Scan engine is not running", nil);
            return;
        }
    }
    
    const char *cmd = [command UTF8String];
    int success = scan_stdin_write(cmd);
    
    if (success) {
        RCTLogInfo(@"Sent command to Scan: %@", command);
        resolve(@(YES));
    } else {
        RCTLogError(@"Failed to send command to Scan: %@", command);
        reject(@"COMMAND_FAILED", @"Failed to send command to Scan", nil);
    }
}

RCT_EXPORT_METHOD(shutdownEngine:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @synchronized(self) {
        if (!engineRunning) {
            resolve(@(YES));
            return;
        }
    }
    
    RCTLogInfo(@"Shutting down Scan engine");
    
    // Send the quit command to Scan
    scan_stdin_write("quit");
    
    // Stop the listener thread
    @synchronized(self) {
        listenerRunning = NO;
    }
    
    // Wait for threads to finish
    @synchronized(self) {
        if (engineRunning) {
            pthread_join(engineThread, NULL);
            engineRunning = NO;
        }
    }
    
    if (pthread_join(listenerThread, NULL) != 0) {
        RCTLogError(@"Failed to join listener thread");
    }
    
    // Clean up C++ bridge
    scan_shutdown();
    
    RCTLogInfo(@"Scan engine shut down successfully");
    resolve(@(YES));
}

#pragma mark - Module Lifecycle

- (void)invalidate
{
    [self shutdownEngine:^(id result) {
        RCTLogInfo(@"Engine shutdown completed during invalidate");
    } rejecter:^(NSString *code, NSString *message, NSError *error) {
        RCTLogError(@"Engine shutdown failed during invalidate: %@", message);
    }];
    [super invalidate];
}

- (void)dealloc
{
    // Ensure cleanup
    @synchronized(self) {
        if (engineRunning || listenerRunning) {
            scan_stdin_write("quit");
            scan_shutdown();
        }
    }
}

@end