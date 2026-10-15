// Only return fixed messages. Git stderr can contain credentials, repository
// URLs and server-controlled text, so it must never become a public error.
function gitFailureMessage(error, stderr = "", operation = "connection") {
  const prefix = operation === "clone" ? "Git 克隆失败" : "Git 连接失败";
  if (error?.code === "ENOENT") return `${prefix}：服务器无法启动 Git，请检查 Git 安装与运行环境。`;
  if (error?.killed) return `${prefix}：连接超时，请检查服务器网络后重试。`;
  if (/SSL certificate|certificate verify failed|SSL_ERROR|server certificate verification failed/i.test(stderr))
    return `${prefix}：TLS 证书验证或安全连接失败，请检查服务器证书与代理配置。`;
  if (/Could not resolve (?:host|proxy)|Name or service not known|nodename nor servname/i.test(stderr))
    return `${prefix}：服务器无法解析 Git 主机或代理地址，请检查 DNS 与代理配置。`;
  if (/Failed to connect|Connection refused|Connection timed out|Network is unreachable|Connection reset|remote end hung up|unexpected disconnect/i.test(stderr))
    return `${prefix}：服务器无法连接 Git 主机或连接已中断，请检查网络与代理后重试。`;
  if (/SAML|single sign.on|SSO/i.test(stderr))
    return `${prefix}：仓库所属组织要求单点登录授权，请为访问令牌或 SSH 密钥完成组织授权。`;
  if (/Authentication failed|Invalid username or|Invalid credentials|HTTP Basic: Access denied|returned error: 401|Permission denied \(publickey|unable to get password from user|could not read (?:Username|Password)/i.test(stderr))
    return `${prefix}：仓库认证被拒绝，请检查已保存的用户名、访问令牌或 SSH 公钥授权。登录验证成功不代表具备仓库访问权限。`;
  if (/Repository not found|repository .+ not found|returned error: 404/i.test(stderr))
    return `${prefix}：仓库不存在或当前账号无权访问，请检查仓库地址及令牌对该仓库的读取权限。`;
  if (/returned error: 403|access denied|access to .+ denied|not allowed to (?:download|access|read)|permission.+denied/i.test(stderr))
    return `${prefix}：仓库拒绝访问，请检查账号权限、令牌的仓库授权及组织访问策略。`;
  if (/redirect|returned error: 30[1278]/i.test(stderr))
    return `${prefix}：仓库地址发生重定向，请填写最终克隆地址后重试。`;
  return operation === "clone"
    ? "Git 克隆失败，请检查网络、远程地址、凭据与磁盘空间后重试。"
    : "Git 连接失败，请检查远程仓库地址、账号密码或 SSH 公钥授权。";
}

module.exports = { gitFailureMessage };
