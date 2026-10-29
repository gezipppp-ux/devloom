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
            values 'linux', 'windows', 'macos-arm64', 'macos-x64'
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
                    sh '''
                      node -e '
                        const target = process.env.PLATFORM;
                        if (target.startsWith("macos-") &&
                            (process.platform !== "darwin" || process.arch !== target.slice(6))) {
                          throw new Error("macOS CI Node architecture mismatch: " + process.platform + "/" + process.arch);
                        }
                      '
                    '''
                    sh 'node --version'
                    sh 'git --version'
                    sh 'npm ci'
                    sh 'npm run db:generate'
                    sh 'npx playwright install --no-shell chromium'
                  } else {
                    bat 'node --version'
                    bat 'git --version'
                    bat 'npm ci'
                    bat 'npm run db:generate'
                    bat 'npx playwright install --no-shell chromium'
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
                    sh 'npx eslint src test web/src web/public web/vite.config.mjs && node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs && npm run build && node test/browser/session.test.cjs && node test/browser/workspaces.test.cjs && node test/browser/dev.test.cjs && node test/browser/accounts.test.cjs && node test/browser/setup.test.cjs && node test/browser/project-collaboration.test.cjs && node test/browser/delivery-queue-real.test.cjs && node test/browser/initialization-retry-real.test.cjs && node test/browser/development-flows.test.cjs && node test/browser/project-editing.test.cjs && node test/browser/visual.test.cjs'
                  } else {
                    bat 'npx eslint src test web/src web/public web/vite.config.mjs && node --test test/architecture/*.test.cjs test/unit/*.test.cjs test/integration/*.test.cjs && npm run build && node test/browser/session.test.cjs && node test/browser/workspaces.test.cjs && node test/browser/dev.test.cjs && node test/browser/accounts.test.cjs && node test/browser/setup.test.cjs && node test/browser/project-collaboration.test.cjs && node test/browser/delivery-queue-real.test.cjs && node test/browser/initialization-retry-real.test.cjs && node test/browser/development-flows.test.cjs && node test/browser/project-editing.test.cjs && node test/browser/visual.test.cjs'
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
