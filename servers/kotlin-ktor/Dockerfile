FROM gradle:9.8.2-jdk25-noble AS build
WORKDIR /src
# Plugins and dependencies in their own layer, so code changes don't download them again.
COPY settings.gradle.kts build.gradle.kts gradle.lockfile buildscript-gradle.lockfile ./
RUN gradle --no-daemon -q dependencies > /dev/null
COPY src ./src
RUN gradle --no-daemon -q shadowJar

# The Temurin images are Ubuntu-based, so the JRE is copied into debian:trixie-slim.
FROM eclipse-temurin:25.0.4.1_1-jre-noble AS jre

FROM debian:trixie-slim
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
COPY --from=build /src/build/libs/app.jar /app.jar
EXPOSE 8080
# Container ergonomics size the JVM from the container's CPU and memory limits. The heap may use
# 60% of the memory limit (the default is 25%), as in java-spring: a common production value for
# small containers, leaving room for metaspace, code cache, thread stacks and Netty's direct
# buffers. At 75% java-spring-vt was killed for running out of memory at 512 MB.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-jar", "/app.jar"]
