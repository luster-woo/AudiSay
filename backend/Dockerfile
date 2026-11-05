# syntax=docker/dockerfile:1.7
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon > /dev/null

COPY src src
RUN ./gradlew bootJar --no-daemon -x test

FROM eclipse-temurin:21-jre
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

# 인증 서류 OCR 모델(286, PaddleOCR PP-OCRv5 ONNX). 체크섬이 다르면 빌드 실패(원본이 바뀐 것)
# 폴더를 먼저 만든다: ADD가 만든 폴더에는 --chmod=644가 걸려 app 사용자가 들어가지 못한다
RUN mkdir -p models/ocr
ADD --checksum=sha256:a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d --chmod=644 \
    https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx models/ocr/det_mobile.onnx
ADD --checksum=sha256:322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa --chmod=644 \
    https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/rec.onnx models/ocr/rec.onnx
ADD --checksum=sha256:a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7 --chmod=644 \
    https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/dict.txt models/ocr/dict.txt
COPY --from=build /app/build/libs/*.jar app.jar
USER app

EXPOSE 8080
# 힙은 컨테이너 메모리의 60%(1536m → 약 920MB, 이전 1g × 75%보다 큼). 나머지는 메타스페이스·스레드·OCR(ONNX Runtime) 힙 밖 메모리
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60.0", "-jar", "app.jar"]
