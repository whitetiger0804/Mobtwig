FROM eclipse-temurin:21.0.12.1_1-jre-noble@sha256:817f192b914584dac49595ae662461250b21aaa31df8698feac767d08defb3d0

# 고정한 공식 JRE 이미지에 readiness 검사에 필요한 curl이 포함되어 있습니다.
RUN groupadd --gid 10001 mobtwig \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin mobtwig

WORKDIR /app
COPY --chown=10001:10001 app.jar app.jar

ENV TZ=UTC
USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
    CMD ["curl", "--fail", "--silent", "--show-error", "--max-time", "3", "--output", "/dev/null", "http://127.0.0.1:8080/actuator/health/readiness"]

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
