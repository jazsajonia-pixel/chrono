#!/usr/bin/env bash
# Builds one fixture project for scripts/live-runtime-smoke.ts into $2 (default /tmp/fixture).
# Fixtures come from official generators/templates where they exist (start.spring.io, JetBrains'
# Kotlin/Wasm template); the Flutter, Dart and Ktor ones are the smallest realistic apps.
set -euo pipefail
name="$1"; out="${2:-/tmp/fixture}"
rm -rf "$out"; mkdir -p "$out"; cd "$out"
spring() { curl -fsSL "https://start.spring.io/starter.zip?$1&dependencies=web&groupId=dev.chrono&artifactId=demo&name=demo&packageName=dev.chrono.demo&javaVersion=21" -o /tmp/s.zip; unzip -q -o /tmp/s.zip -d "$out"; rm /tmp/s.zip; }
case "$name" in
  flutter)
    # No web/ folder on purpose: the start script must add it with `flutter create --platforms web`.
    mkdir -p lib
    printf 'name: hello_flutter\npublish_to: none\nenvironment:\n  sdk: ^3.5.0\ndependencies:\n  flutter:\n    sdk: flutter\nflutter:\n  uses-material-design: true\n' > pubspec.yaml
    printf "import 'package:flutter/material.dart';\n\nvoid main() => runApp(const MaterialApp(home: Scaffold(body: Center(child: Text('Hello from Flutter')))));\n" > lib/main.dart ;;
  dart)
    mkdir -p bin
    printf 'name: hello_dart\npublish_to: none\nenvironment:\n  sdk: ^3.5.0\ndependencies:\n  shelf: ^1.4.0\n' > pubspec.yaml
    cat > bin/server.dart <<'DART'
import 'dart:io';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as io;

void main() async {
  final port = int.parse(Platform.environment['PORT'] ?? '8080');
  final server = await io.serve((Request r) => Response.ok('{"ok":true}', headers: {'content-type': 'application/json'}), InternetAddress.anyIPv4, port);
  print('Serving at http://${server.address.host}:${server.port}');
}
DART
    ;;
  spring-gradle)
    spring "type=gradle-project-kotlin&language=kotlin"
    mkdir -p src/main/kotlin/dev/chrono/demo
    printf 'package dev.chrono.demo\n\nimport org.springframework.web.bind.annotation.GetMapping\nimport org.springframework.web.bind.annotation.RestController\n\n@RestController\nclass Hello {\n    @GetMapping("/") fun hello() = mapOf("ok" to true)\n}\n' > src/main/kotlin/dev/chrono/demo/Hello.kt ;;
  spring-maven)
    spring "type=maven-project&language=java"
    printf 'package dev.chrono.demo;\n\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RestController;\n\n@RestController\nclass Hello {\n    @GetMapping("/") String hello() { return "hello"; }\n}\n' > src/main/java/dev/chrono/demo/Hello.java ;;
  ktor)
    # Gradle wrapper borrowed from a generated Spring project; the build itself is plain Ktor.
    spring "type=gradle-project-kotlin&language=kotlin"
    find . -mindepth 1 -maxdepth 1 ! -name gradlew ! -name gradle -exec rm -rf {} +
    printf 'rootProject.name = "hello-ktor"\n' > settings.gradle.kts
    cat > build.gradle.kts <<'KTS'
plugins {
    kotlin("jvm") version "2.1.0"
    id("io.ktor.plugin") version "3.0.3"
}
repositories { mavenCentral() }
application { mainClass.set("dev.chrono.ApplicationKt") }
dependencies {
    implementation("io.ktor:ktor-server-core")
    implementation("io.ktor:ktor-server-netty")
    implementation("ch.qos.logback:logback-classic:1.5.12")
}
kotlin { jvmToolchain(21) }
KTS
    mkdir -p src/main/kotlin/dev/chrono
    printf 'package dev.chrono\n\nimport io.ktor.server.engine.*\nimport io.ktor.server.netty.*\nimport io.ktor.server.response.*\nimport io.ktor.server.routing.*\n\nfun main() {\n    embeddedServer(Netty, port = 8080, host = "0.0.0.0") { routing { get("/") { call.respondText("hello ktor") } } }.start(wait = true)\n}\n' > src/main/kotlin/dev/chrono/Application.kt ;;
  kotlin-wasm)
    git clone --depth 1 https://github.com/Kotlin/kotlin-wasm-compose-template.git "$out" ;;
  *) echo "unknown fixture $name" >&2; exit 2 ;;
esac
echo "fixture $name ready in $out"; find "$out" -maxdepth 2 -not -path '*/.git*' | head -40
