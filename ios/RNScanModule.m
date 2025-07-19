//
//  RNScanModule.m
//  dawikk-scan
//
//  Fixed React Native bridge for the Scan draughts engine
//  Thread-safe implementation with proper error handling
//
//  Created by dawikk-scan
//  Copyright © 2024. All rights reserved.
//

#import "RNScanModule.h"
#import <React/RCTLog.h>
#import <React/RCTUtils.h>

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
NSString * const kScanEventError = @"scan-error";
NSString * const kScanEventStatus = @"scan-status";

// Engine status constants
NSString * const kScanStatusStopped = @"stopped";
NSString * const kScanStatusInitializing = @"initializing";
NSString * const kScanStatusReady = @"ready";
NSString * const kScanStatusThinking = @"thinking";
NSString * const kScanStatusError = @"error";

// Standard starting position for international draughts
NSString * const kScanStartingPosition = @"Wbbbbbbbbbbbbbbbbbbbbeeeeeeeeeewwwwwwwwwwwwwwwwwwww";

// Error codes
NSString * const kScanErrorInitFailed = @"INIT_FAILED";
NSString * const kScanErrorNotInitialized = @"NOT_INITIALIZED";
NSString * const kScanErrorAlreadyRunning = @"ALREADY_RUNNING";
NSString * const kScanErrorInvalidCommand = @"INVALID_COMMAND";
NSString * const kScanErrorEngineError = @"ENGINE_ERROR";
NSString * const kScanErrorTimeout = @"TIMEOUT";

#pragma mark - Message Callback

// C callback function for engine messages
void engineMessageCallback(const char* message, void* context) {
    if (!message || !context) return;
    
    RNScanModule* module = (__bridge RNScanModule*)context;
    NSString* messageString = [NSString stringWithUTF8String:message];
    
    // Dispatch to main queue to ensure thread safety
    dispatch_async(dispatch_get_main_queue(), ^{
        [module processEngineMessage:messageString];
    });
}

#pragma mark - Implementation

@implementation RNScanModule {
    NSString *_dataPath;
    NSString *_lastStatus;
    NSString *_lastError;
    dispatch_queue_t _engineQueue;
    BOOL _hasListeners;
}

#pragma mark - Module Setup

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[kScanEventOutput, kScanEventAnalyzedOutput, kScanEventError, kScanEventStatus];
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _dataPath = nil;
        _lastStatus = kScanStatusStopped;
        _lastError = nil;
        _hasListeners = NO;
        
        // Create a serial queue for engine operations
        _engineQueue = dispatch_queue_create("com.dawikk.scan.engine", DISPATCH_QUEUE_SERIAL);
        
        [self setupDataPath];
        [self setupEngineCallback];
    }
    return self;
}

- (void)startObserving {
    _hasListeners = YES;
}

- (void)stopObserving {
    _hasListeners = NO;
}

#pragma mark - Property Getters

- (BOOL)isEngineInitialized {
    ScanStatus status = scan_bridge_get_status();
    return status != SCAN_STATUS_STOPPED;
}

- (BOOL)isEngineReady {
    return scan_bridge_is_ready();
}

- (NSString *)engineStatus {
    return [self statusStringFromEnum:scan_bridge_get_status()];
}

- (NSString *)lastError {
    const char* errorCStr = scan_bridge_get_last_error();
    if (errorCStr && strlen(errorCStr) > 0) {
        return [NSString stringWithUTF8String:errorCStr];
    }
    return _lastError;
}

- (NSString *)dataPath {
    return _dataPath;
}

#pragma mark - Setup Methods

- (void)setupDataPath {
    // Get the path to the ScanData bundle
    NSBundle *scanBundle = [NSBundle bundleWithPath:[[NSBundle mainBundle] pathForResource:@"ScanData" ofType:@"bundle"]];
    if (scanBundle) {
        _dataPath = [scanBundle bundlePath];
        RCTLogInfo(@"ScanData bundle found at: %@", _dataPath);
        
        // Set working directory to the data path so Scan can find its files
        const char *path = [_dataPath UTF8String];
        if (chdir(path) != 0) {
            RCTLogError(@"Failed to change working directory to: %@", _dataPath);
        } else {
            RCTLogInfo(@"Changed working directory to: %@", _dataPath);
        }
    } else {
        RCTLogError(@"ScanData bundle not found!");
        // Try to find data in main bundle as fallback
        _dataPath = [[NSBundle mainBundle] bundlePath];
        RCTLogInfo(@"Using main bundle path as fallback: %@", _dataPath);
    }
}

- (void)setupEngineCallback {
    // Set up the C callback for engine messages
    scan_bridge_set_callback(engineMessageCallback, (__bridge void*)self);
}

#pragma mark - Status Helpers

- (NSString *)statusStringFromEnum:(ScanStatus)status {
    switch (status) {
        case SCAN_STATUS_STOPPED:
            return kScanStatusStopped;
        case SCAN_STATUS_INITIALIZING:
            return kScanStatusInitializing;
        case SCAN_STATUS_READY:
            return kScanStatusReady;
        case SCAN_STATUS_THINKING:
            return kScanStatusThinking;
        case SCAN_STATUS_ERROR:
            return kScanStatusError;
        default:
            return kScanStatusError;
    }
}

- (NSString *)errorCodeFromEnum:(ScanResult)result {
    switch (result) {
        case SCAN_SUCCESS:
            return nil;
        case SCAN_ERROR_INIT_FAILED:
            return kScanErrorInitFailed;
        case SCAN_ERROR_NOT_INITIALIZED:
            return kScanErrorNotInitialized;
        case SCAN_ERROR_ALREADY_RUNNING:
            return kScanErrorAlreadyRunning;
        case SCAN_ERROR_INVALID_COMMAND:
            return kScanErrorInvalidCommand;
        case SCAN_ERROR_ENGINE_ERROR:
            return kScanErrorEngineError;
        case SCAN_ERROR_TIMEOUT:
            return kScanErrorTimeout;
        default:
            return kScanErrorEngineError;
    }
}

#pragma mark - Engine Message Processing

- (void)processEngineMessage:(NSString *)message {
    if (message.length == 0) return;
    
    // Trim whitespace and newlines
    NSString *trimmedMessage = [message stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (trimmedMessage.length == 0) return;
    
    // Send raw output to JavaScript
    [self emitRawOutput:trimmedMessage];
    
    // Process HUB protocol output
    if ([trimmedMessage hasPrefix:@"info"]) {
        [self processAnalysisOutput:trimmedMessage];
    } else if ([trimmedMessage hasPrefix:@"done"]) {
        [self processBestMoveOutput:trimmedMessage];
    } else if ([trimmedMessage hasPrefix:@"id"]) {
        [self processEngineInfo:trimmedMessage];
    } else if ([trimmedMessage hasPrefix:@"param"]) {
        [self processParameterInfo:trimmedMessage];
    } else if ([trimmedMessage hasPrefix:@"error"]) {
        [self processErrorMessage:trimmedMessage];
    } else if ([trimmedMessage hasPrefix:@"wait"] || 
               [trimmedMessage hasPrefix:@"ready"] || 
               [trimmedMessage hasPrefix:@"pong"]) {
        [self processStatusMessage:trimmedMessage];
    }
    
    // Check for status changes
    [self checkStatusChange];
}

- (void)processAnalysisOutput:(NSString *)line {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"info";
    
    [self parseHubLine:line intoDictionary:result];
    
    // Convert string values to appropriate types
    [self convertAnalysisValues:result];
    
    [self emitAnalyzedOutput:result];
}

- (void)processBestMoveOutput:(NSString *)line {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"bestmove";
    
    [self parseHubLine:line intoDictionary:result];
    
    [self emitAnalyzedOutput:result];
}

- (void)processEngineInfo:(NSString *)line {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"id";
    
    [self parseHubLine:line intoDictionary:result];
    
    [self emitAnalyzedOutput:result];
}

- (void)processParameterInfo:(NSString *)line {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = @"param";
    
    [self parseHubLine:line intoDictionary:result];
    
    [self emitAnalyzedOutput:result];
}

- (void)processErrorMessage:(NSString *)line {
    NSMutableDictionary *errorInfo = [NSMutableDictionary dictionary];
    [self parseHubLine:line intoDictionary:errorInfo];
    
    NSString *errorMessage = errorInfo[@"message"] ?: line;
    _lastError = errorMessage;
    
    [self emitError:errorMessage];
}

- (void)processStatusMessage:(NSString *)line {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"type"] = line;
    result[@"message"] = line;
    
    [self emitAnalyzedOutput:result];
}

- (void)convertAnalysisValues:(NSMutableDictionary *)result {
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
}

- (void)parseHubLine:(NSString *)line intoDictionary:(NSMutableDictionary *)dict {
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

- (void)checkStatusChange {
    NSString *currentStatus = [self engineStatus];
    if (![currentStatus isEqualToString:_lastStatus]) {
        _lastStatus = currentStatus;
        [self emitStatusChange:currentStatus];
    }
}

#pragma mark - Event Emission

- (void)emitRawOutput:(NSString *)message {
    if (_hasListeners) {
        [self sendEventWithName:kScanEventOutput body:message];
    }
}

- (void)emitAnalyzedOutput:(NSDictionary *)data {
    if (_hasListeners) {
        [self sendEventWithName:kScanEventAnalyzedOutput body:data];
    }
}

- (void)emitError:(NSString *)error {
    if (_hasListeners) {
        [self sendEventWithName:kScanEventError body:@{@"error": error}];
    }
}

- (void)emitStatusChange:(NSString *)status {
    if (_hasListeners) {
        [self sendEventWithName:kScanEventStatus body:@{@"status": status}];
    }
}

#pragma mark - React Native Exported Methods

RCT_EXPORT_METHOD(initEngine:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    dispatch_async(_engineQueue, ^{
        ScanResult result = scan_bridge_init();
        
        dispatch_async(dispatch_get_main_queue(), ^{
            if (result == SCAN_SUCCESS) {
                RCTLogInfo(@"Scan engine initialized successfully");
                resolve(@(YES));
            } else {
                NSString *errorCode = [self errorCodeFromEnum:result];
                NSString *errorMessage = [self lastError] ?: @"Failed to initialize Scan engine";
                RCTLogError(@"Failed to initialize Scan engine: %@", errorMessage);
                reject(errorCode, errorMessage, nil);
            }
        });
    });
}

RCT_EXPORT_METHOD(startEngine:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    dispatch_async(_engineQueue, ^{
        ScanResult result = scan_bridge_start();
        
        dispatch_async(dispatch_get_main_queue(), ^{
            if (result == SCAN_SUCCESS) {
                RCTLogInfo(@"Scan engine started successfully");
                resolve(@(YES));
            } else {
                NSString *errorCode = [self errorCodeFromEnum:result];
                NSString *errorMessage = [self lastError] ?: @"Failed to start Scan engine";
                RCTLogError(@"Failed to start Scan engine: %@", errorMessage);
                reject(errorCode, errorMessage, nil);
            }
        });
    });
}

RCT_EXPORT_METHOD(sendCommand:(NSString *)command
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    if (command.length == 0) {
        reject(kScanErrorInvalidCommand, @"Command cannot be empty", nil);
        return;
    }
    
    dispatch_async(_engineQueue, ^{
        ScanResult result = scan_bridge_send_command([command UTF8String]);
        
        dispatch_async(dispatch_get_main_queue(), ^{
            if (result == SCAN_SUCCESS) {
                RCTLogInfo(@"Sent command to Scan: %@", command);
                resolve(@(YES));
            } else {
                NSString *errorCode = [self errorCodeFromEnum:result];
                NSString *errorMessage = [NSString stringWithFormat:@"Failed to send command: %@", command];
                RCTLogError(@"%@", errorMessage);
                reject(errorCode, errorMessage, nil);
            }
        });
    });
}

RCT_EXPORT_METHOD(getStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    NSString *status = [self engineStatus];
    resolve(status);
}

RCT_EXPORT_METHOD(isReady:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    BOOL ready = scan_bridge_is_ready();
    resolve(@(ready));
}

RCT_EXPORT_METHOD(waitReady:(NSNumber *)timeout
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    int timeoutSeconds = [timeout intValue];
    if (timeoutSeconds <= 0) {
        timeoutSeconds = 10; // Default timeout
    }
    
    dispatch_async(_engineQueue, ^{
        BOOL ready = scan_bridge_wait_ready(timeoutSeconds);
        
        dispatch_async(dispatch_get_main_queue(), ^{
            resolve(@(ready));
        });
    });
}

RCT_EXPORT_METHOD(shutdownEngine:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    dispatch_async(_engineQueue, ^{
        scan_bridge_shutdown();
        
        dispatch_async(dispatch_get_main_queue(), ^{
            RCTLogInfo(@"Scan engine shut down successfully");
            resolve(@(YES));
        });
    });
}

#pragma mark - Convenience Methods

RCT_EXPORT_METHOD(analyzePosition:(NSString *)position
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    if (position.length == 0) {
        reject(kScanErrorInvalidCommand, @"Position cannot be empty", nil);
        return;
    }
    
    dispatch_async(_engineQueue, ^{
        // Send commands in sequence
        NSMutableArray *commands = [NSMutableArray array];
        [commands addObject:@"hub"];
        [commands addObject:@"init"];
        [commands addObject:[NSString stringWithFormat:@"pos pos=%@", position]];
        
        // Add level commands based on options
        NSNumber *depth = options[@"depth"];
        NSNumber *time = options[@"time"];
        NSNumber *nodes = options[@"nodes"];
        BOOL infinite = [options[@"infinite"] boolValue];
        
        if (depth && !infinite) {
            [commands addObject:[NSString stringWithFormat:@"level depth=%@", depth]];
        }
        if (time) {
            [commands addObject:[NSString stringWithFormat:@"level move-time=%.3f", [time doubleValue] / 1000.0]];
        }
        if (nodes) {
            [commands addObject:[NSString stringWithFormat:@"level nodes=%@", nodes]];
        }
        if (infinite) {
            [commands addObject:@"level infinite"];
        }
        
        [commands addObject:@"go analyze"];
        
        // Send all commands
        BOOL success = YES;
        for (NSString *cmd in commands) {
            ScanResult result = scan_bridge_send_command([cmd UTF8String]);
            if (result != SCAN_SUCCESS) {
                success = NO;
                break;
            }
            // Small delay between commands
            usleep(10000); // 10ms
        }
        
        dispatch_async(dispatch_get_main_queue(), ^{
            if (success) {
                resolve(@(YES));
            } else {
                reject(kScanErrorEngineError, @"Failed to start analysis", nil);
            }
        });
    });
}

RCT_EXPORT_METHOD(getBestMove:(NSString *)position
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    if (position.length == 0) {
        reject(kScanErrorInvalidCommand, @"Position cannot be empty", nil);
        return;
    }
    
    dispatch_async(_engineQueue, ^{
        // Send commands for move search
        NSMutableArray *commands = [NSMutableArray array];
        [commands addObject:@"hub"];
        [commands addObject:@"init"];
        [commands addObject:[NSString stringWithFormat:@"pos pos=%@", position]];
        
        // Add search parameters
        NSNumber *depth = options[@"depth"] ?: @15;
        NSNumber *time = options[@"time"] ?: @1000;
        
        [commands addObject:[NSString stringWithFormat:@"level depth=%@", depth]];
        [commands addObject:[NSString stringWithFormat:@"level move-time=%.3f", [time doubleValue] / 1000.0]];
        [commands addObject:@"go think"];
        
        // Send all commands
        BOOL success = YES;
        for (NSString *cmd in commands) {
            ScanResult result = scan_bridge_send_command([cmd UTF8String]);
            if (result != SCAN_SUCCESS) {
                success = NO;
                break;
            }
            usleep(10000); // 10ms delay
        }
        
        dispatch_async(dispatch_get_main_queue(), ^{
            if (success) {
                resolve(@(YES));
            } else {
                reject(kScanErrorEngineError, @"Failed to start move search", nil);
            }
        });
    });
}

RCT_EXPORT_METHOD(stopAnalysis:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    dispatch_async(_engineQueue, ^{
        ScanResult result = scan_bridge_send_command("stop");
        
        dispatch_async(dispatch_get_main_queue(), ^{
            if (result == SCAN_SUCCESS) {
                resolve(@(YES));
            } else {
                NSString *errorCode = [self errorCodeFromEnum:result];
                reject(errorCode, @"Failed to stop analysis", nil);
            }
        });
    });
}

RCT_EXPORT_METHOD(setParameters:(NSDictionary *)params
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    
    if (params.count == 0) {
        resolve(@(YES));
        return;
    }
    
    dispatch_async(_engineQueue, ^{
        BOOL success = YES;
        
        for (NSString *name in params) {
            NSString *value = [NSString stringWithFormat:@"%@", params[name]];
            NSString *command = [NSString stringWithFormat:@"set-param name=%@ value=%@", name, value];
            
            ScanResult result = scan_bridge_send_command([command UTF8String]);
            if (result != SCAN_SUCCESS) {
                success = NO;
                break;
            }
            usleep(10000); // 10ms delay
        }
        
        dispatch_async(dispatch_get_main_queue(), ^{
            if (success) {
                resolve(@(YES));
            } else {
                reject(kScanErrorEngineError, @"Failed to set parameters", nil);
            }
        });
    });
}

#pragma mark - Module Lifecycle

- (void)invalidate {
    [self shutdownEngine:^(id result) {
        RCTLogInfo(@"Engine shutdown completed during invalidate");
    } rejecter:^(NSString *code, NSString *message, NSError *error) {
        RCTLogError(@"Engine shutdown failed during invalidate: %@", message);
    }];
    [super invalidate];
}

- (void)dealloc {
    scan_bridge_shutdown();
}

@end