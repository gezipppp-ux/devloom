pipeline {
  agent none
  options {
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
    timeout(time: 30, unit: 'MINUTES')
  }
  environment {
    CI = 'true'
    BROWSER_CHANNEL = 'chromium'
  }
  stages {
    stage('Cross-platform verification') {
      matrix {
        axes {
          axis {
            name 'PLATFORM'
            values 'linux', 'windows'
          }
        }
        agent { label "web-coding-${PLATFORM}" }
        stages {
          stage('Checkout') {
            steps {
              dir("verification/${PLATFORM}/state/browser") {
                deleteDir()
              }
              dir("verification/${PLATFORM}") {
                checkout scm
              }
            }
          }
          stage('Install') {
            steps {
              dir("verification/${PLATFORM}") {
                script {
                  if (isUnix()) {
                    sh 'node --version'
                    sh 'git --version'
                    sh 'npm ci'
                    sh 'npx playwright install chromium'
                  } else {
                    bat 'node --version'
                    bat 'git --version'
                    bat 'npm ci'
                    bat 'npx playwright install chromium'
                  }
                }
              }
            }
          }
          stage('Verify') {
            steps {
              dir("verification/${PLATFORM}") {
                script {
                  if (isUnix()) {
                    sh 'npm run verify'
                  } else {
                    bat 'npm run verify'
                  }
                }
              }
            }
          }
        }
        post {
          always {
            archiveArtifacts artifacts: "verification/${PLATFORM}/state/browser/**/*.png,verification/${PLATFORM}/state/browser/**/*.html", allowEmptyArchive: true
          }
        }
      }
    }
  }
}
