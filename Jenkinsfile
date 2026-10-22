// 서비스 이름 : 폴더 (워커가 준비되면 worker: 'ai' 추가)
SERVICES = [backend: 'backend', frontend: 'frontend']
INFRA_SERVICES = 'postgres redis rabbitmq'

def isMain() {
    return (env.GIT_BRANCH ?: '').endsWith('main')
}

@NonCPS
def changedIn(String dir) {
    for (cs in currentBuild.changeSets) {
        for (entry in cs.items) {
            for (path in entry.affectedPaths) {
                if (path.startsWith(dir + '/')) { return true }
            }
        }
    }
    return false
}

def notifyMM(String text) {
    try {
        writeFile file: 'mm.json', text: """{"text": "${text}"}""", encoding: 'UTF-8'
        withCredentials([string(credentialsId: 'mattermost-webhook', variable: 'MM_URL')]) {
            sh 'curl -s -X POST -H "Content-Type: application/json; charset=utf-8" -d @mm.json "$MM_URL"'
        }
    } catch (e) {
        echo "MatterMost 알림 실패: ${e.message}"
    }
}

pipeline {
    agent any

    options {
        gitLabConnection('lab-ssafy')
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        COMPOSE    = 'docker compose -f infra/docker-compose.prod.yml --env-file infra/.env'
        // Docker 내부망 주소로 직접 확인 (Nginx·HTTPS와 무관)
        // 백엔드가 context-path=/api를 쓰지 않으면 /actuator/health로 수정
        HEALTH_URL = 'http://backend:8080/actuator/health'
    }

    stages {
        stage('Prepare') {
            steps {
                updateGitlabCommitStatus name: 'jenkins', state: 'running'
                withCredentials([file(credentialsId: 'audisay-env', variable: 'ENV_FILE')]) {
                    sh 'cp "$ENV_FILE" infra/.env'
                }
                echo "브랜치: ${env.GIT_BRANCH}, 배포 여부: ${isMain()}"
            }
        }

        stage('Build') {
            steps {
                script {
                    def targets = []
                    for (svc in (SERVICES.keySet() as List)) {
                        def dir = SERVICES[svc]
                        if (!fileExists("${dir}/Dockerfile")) {
                            echo "${dir}/Dockerfile 없음 → ${svc} 건너뜀"
                            continue
                        }
                        if (isMain() || changedIn(dir)) {
                            targets << svc
                        }
                    }
                    if (targets) {
                        sh "${COMPOSE} build ${targets.join(' ')}"
                    } else {
                        echo '빌드할 서비스 없음'
                    }
                }
            }
        }

        stage('Deploy') {
            when { expression { isMain() } }
            steps {
                script {
                    def targets = INFRA_SERVICES
                    for (svc in (SERVICES.keySet() as List)) {
                        if (fileExists("${SERVICES[svc]}/Dockerfile")) {
                            targets += " ${svc}"
                        }
                    }
                    sh "${COMPOSE} up -d ${targets}"
                    sh 'docker image prune -f'
                }
            }
        }

        stage('Health check') {
            when {
                expression { isMain() && fileExists('backend/Dockerfile') && env.SKIP_HEALTH != 'true' }
            }
            steps {
                sh '''
                  docker pull -q curlimages/curl:8.10.1 > /dev/null
                  for i in $(seq 1 24); do
                    if docker run --rm --network audisay_default curlimages/curl:8.10.1 -fs "$HEALTH_URL" > /dev/null; then
                      echo "헬스 체크 OK"; exit 0
                    fi
                    echo "기다리는 중... ($i/24)"; sleep 5
                  done
                  echo "헬스 체크 실패"; exit 1
                '''
            }
        }
    }

    post {
        success {
            updateGitlabCommitStatus name: 'jenkins', state: 'success'
            script {
                if (isMain()) { notifyMM("배포 성공: ${env.JOB_NAME} #${env.BUILD_NUMBER}") }
            }
        }
        failure {
            updateGitlabCommitStatus name: 'jenkins', state: 'failed'
            notifyMM("빌드 실패: ${env.JOB_NAME} #${env.BUILD_NUMBER} ${env.BUILD_URL}")
        }
        cleanup {
            deleteDir()     // 작업 폴더의 .env까지 삭제
        }
    }
}
