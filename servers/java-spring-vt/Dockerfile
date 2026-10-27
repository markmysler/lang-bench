FROM maven:3.10.0-eclipse-temurin-25-noble AS build
WORKDIR /src
# Dependencies in their own layer, so code changes don't download them again.
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q package -DskipTests

# The Temurin images are Ubuntu-based, so the JRE is copied into debian:trixie-slim.
FROM eclipse-temurin:25.0.4.1_1-jre-noble AS jre

FROM debian:trixie-slim
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
COPY --from=build /src/target/app.jar /app.jar
EXPOSE 8080
# Container ergonomics size the JVM from the container's CPU and memory limits. The heap may use
# 60% of the memory limit (the default is 25%): a common production value for small containers,
# leaving room for metaspace, code cache and thread stacks. At 75% java-spring-vt was killed for
# running out of memory at 512 MB under the I/O workload (seen with virtual threads).
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-jar", "/app.jar"]
