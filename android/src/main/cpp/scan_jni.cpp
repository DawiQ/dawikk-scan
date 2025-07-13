#include <jni.h>
#include <string>
#include <android/log.h>
#include "scan_bridge.h"

#define LOGI(...) ((void)__android_log_print(ANDROID_LOG_INFO, "ScanNative", __VA_ARGS__))
#define LOGE(...) ((void)__android_log_print(ANDROID_LOG_ERROR, "ScanNative", __VA_ARGS__))

extern "C" {

JNIEXPORT jint JNICALL Java_com_dawikk_scan_RNScanModule_nativeInit(
        JNIEnv *env, jobject instance) {
    LOGI("Initializing Scan");
    return scan_init();
}

JNIEXPORT jint JNICALL Java_com_dawikk_scan_RNScanModule_nativeMain(
        JNIEnv *env, jobject instance) {
    LOGI("Starting Scan main");
    return scan_main();
}

JNIEXPORT jstring JNICALL Java_com_dawikk_scan_RNScanModule_nativeReadOutput(
        JNIEnv *env, jobject instance) {
    const char *output = scan_stdout_read();
    if (output != NULL && output[0] != '\0') {
        return env->NewStringUTF(output);
    }
    return NULL;
}

JNIEXPORT jboolean JNICALL Java_com_dawikk_scan_RNScanModule_nativeSendCommand(
        JNIEnv *env, jobject instance, jstring command) {
    const char *cmd = env->GetStringUTFChars(command, NULL);
    if (cmd == NULL) {
        return JNI_FALSE;
    }
    
    bool success = scan_stdin_write(cmd);
    env->ReleaseStringUTFChars(command, cmd);
    
    return success ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL Java_com_dawikk_scan_RNScanModule_nativeSetVariant(
        JNIEnv *env, jobject instance, jstring variant) {
    const char *var = env->GetStringUTFChars(variant, NULL);
    if (var == NULL) {
        return JNI_FALSE;
    }
    
    bool success = scan_set_variant(var);
    env->ReleaseStringUTFChars(variant, var);
    
    return success ? JNI_TRUE : JNI_FALSE;
}

}