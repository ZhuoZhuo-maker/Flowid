# Flowid 授权服务（auth-server）部署教程

本文说明如何把仓库里的 **`server/auth-server.cjs`** 部署到一台公网可访问的机器上，供桌面端 / 网页端使用：**授权码激活与校验**、**预设模板列表与下载**、**管理后台** 等均依赖此服务。

> 最低要求：一台能装 **Node.js 20+** 的 Linux 云主机（Ubuntu 22.04 等）、一个域名（可选但强烈建议，用于 HTTPS）、基础命令行能力。

---

## 腾讯云（CVM / 轻量）怎么选、怎么开端口

下面只写和**腾讯云控制台**相关的差异点；机器里装 Node、systemd、Nginx 等步骤仍从下文 **「1. 准备云主机」** 起通用执行即可。

### 选哪种机器

| 产品 | 说明 |
|------|------|
| **轻量应用服务器** | 套餐价常含流量包，适合个人/小团队；控制台入口：[轻量应用服务器](https://console.cloud.tencent.com/lighthouse) |
| **云服务器 CVM** | 功能更全（VPC、安全组更细），适合以后要接负载均衡、多实例；入口：[云服务器](https://console.cloud.tencent.com/cvm) |

镜像建议选 **Ubuntu 22.04 LTS**（与下文命令一致）。

### 拿到登录方式

1. 购买时在控制台设置 **root 密码**（或绑定 SSH 密钥）。  
2. 在实例详情页查看 **公网 IP**。  
3. 本机终端：`ssh root@<公网IP>`（Windows 可用 PowerShell / PuTTY）。

### 安全组 / 防火墙（必做）

不放行端口，外网无法访问你的网站与 HTTPS。

- **轻量**：实例详情 → **防火墙** → 添加规则：  
  **TCP 22**（SSH）、**TCP 80**、**TCP 443**；若暂时直连 Node 调试，可再加 **TCP 3721**（生产仍建议只开 80/443，由 Nginx 反代到本机 3721）。  
  说明文档：[轻量防火墙](https://cloud.tencent.com/document/product/1207/87888)
- **CVM**：**安全组** → 绑定到实例 → **入站规则**：同上。  
  说明文档：[安全组概述](https://cloud.tencent.com/document/product/213/39740)

### 域名与解析（DNSPod）

域名在腾讯云时，控制台：[DNS 解析 DNSPod](https://console.cloud.tencent.com/cns)

1. 添加 **A 记录**：主机记录如 `auth`，记录值为服务器 **公网 IP**。  
2. 生效后本机可 `ping auth.你的域名.com` 粗测（部分网络禁 ping，以浏览器 / `curl` 为准）。

### HTTPS 证书两种常见做法（二选一）

1. **Certbot + Let’s Encrypt**（与正文第 7 节一致，免费、自动续期）：适合已有 Nginx、域名已解析到本机。  
2. **腾讯云 SSL 证书**（可申请免费 DV 证书）：在 [SSL 证书控制台](https://console.cloud.tencent.com/ssl) 申请并下载 **Nginx** 格式，把 `crt/key` 配进 Nginx 的 `ssl_certificate` / `ssl_certificate_key`；续期需在控制台按提示替换或改自动化脚本。

### 备案与合规（提醒）

若使用 **国内大陆机房** 且通过 **80/443 对外提供 Web 服务**，域名通常需要 **ICP 备案**（以腾讯云备案要求为准）。仅内网或仅境外机房策略不同，上线前请在控制台查看 [网站备案](https://cloud.tencent.com/product/ba) 说明。

---

## 1. 准备云主机与域名

1. 购买一台 **VPS / 轻量应用服务器**（1 核 1G 通常足够起步）。
2. 在安全组 / 防火墙中放行：**22**（SSH）、**80**（HTTP，申请证书）、**443**（HTTPS）。  
   - 若暂时不用 Nginx，也可只放行 **`AUTH_SERVER_PORT`**（默认 **3721**），但生产环境**务必**前面加 **HTTPS 反向代理**，不要长期裸 HTTP 对外。
3. （推荐）将域名 **`auth.example.com`** 解析到该机器公网 IP。

---

## 2. 安装 Node.js 与 Git

以 **Ubuntu 22.04** 为例：

```bash
sudo apt update
sudo apt install -y curl git
# Node 20 LTS（使用 NodeSource，可按官网文档替换）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # 应显示 v20.x
```

---

## 3. 上传代码

任选其一：

**方式 A：Git 克隆（推荐）**

```bash
cd /opt
sudo git clone <你的仓库地址> flowid
sudo chown -R $USER:$USER /opt/flowid
cd /opt/flowid/FLOWID
```

**方式 B：本机打包上传**

在开发机将 `FLOWID` 目录打成 zip，用 `scp` 传到服务器后解压到 `/opt/flowid/FLOWID`。

---

## 4. 安装依赖

`auth-server` 使用项目根目录 `package.json` 中的 **`express`**、**`cors`** 等依赖，需在 **`FLOWID` 根目录**安装：

```bash
cd /opt/flowid/FLOWID
npm ci --omit=dev
```

仅开发依赖可省略；若 `npm ci` 报错，可用 `npm install --omit=dev`。

---

## 5. 生产环境变量（必改）

**不要**使用默认管理员口令与默认 HMAC 密钥。在服务器上创建环境文件，例如 `/opt/flowid/FLOWID/.env.auth`（路径自定，勿提交到 Git）：

```bash
NODE_ENV=production
AUTH_SERVER_PORT=3721

# 管理后台口令：请求头 x-admin-token 必须与此一致（生产必改）
AUTH_ADMIN_SECRET=请替换为长随机串

# 系统提示词 HMAC：生产必改
SYSTEM_PROMPT_HMAC_SECRET=请替换为另一长随机串

# 可选：新发行授权默认天数
# AUTH_LICENSE_DAYS=365
```

生成随机串示例（在服务器执行）：

```bash
openssl rand -hex 32
```

---

## 6. 用 systemd 常驻运行

创建服务文件 `/etc/systemd/system/flowid-auth.service`：

```ini
[Unit]
Description=Flowid Auth Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/flowid/FLOWID
EnvironmentFile=/opt/flowid/FLOWID/.env.auth
ExecStart=/usr/bin/node server/auth-server.cjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable flowid-auth
sudo systemctl start flowid-auth
sudo systemctl status flowid-auth
```

日志：

```bash
journalctl -u flowid-auth -f
```

启动成功后，本机可测：

```bash
curl -sS http://127.0.0.1:3721/healthz
```

应返回 JSON（含健康字段）。

---

## 7. Nginx 反向代理 + HTTPS（强烈推荐）

安装 Nginx 与 Certbot：

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

新建站点配置 `/etc/nginx/sites-available/flowid-auth`：

```nginx
server {
    listen 80;
    server_name auth.example.com;
    location / {
        proxy_pass http://127.0.0.1:3721;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 30m;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/flowid-auth /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d auth.example.com
```

之后对外地址为：**`https://auth.example.com`**（无端口，或 443）。

---

## 8. 客户端里填的地址

1. 打开 Flowid **授权 / 工作流设置** 中保存 **`baseUrl`** 的地方，填：  
   **`https://auth.example.com`**（**不要**末尾斜杠，**不要**带 `/admin`）。
2. 用户激活、拉预设、调用预设时，会请求：  
   `GET /templates/groups`、`GET /templates/:id/workflow`、`POST /license/verify` 等。

---

## 9. 管理后台

浏览器打开：

```text
https://auth.example.com/admin.html
```

在页面底部填写 **`x-admin-token`** = 你设置的 **`AUTH_ADMIN_SECRET`**，再操作 **License / 预设模板** 等。

---

## 10. 数据持久化与备份

以下目录/文件在 **`FLOWID/server/`** 下（与 `auth-server.cjs` 同级），**务必定期备份**：

| 路径 | 含义 |
|------|------|
| `auth-db.json` | 授权码、绑定关系等 |
| `templates/` | 预设模板索引与 `.workflow.json` |
| `system-prompts/` | 系统提示词 |
| `user-agreement.json` | 用户协议 |
| `cloud-models.json` | 云端模型配置 |

升级代码时注意不要覆盖这些文件；建议先备份再部署。

---

## 11. 常见问题

**Q：客户端仍连 `127.0.0.1:3721`？**  
A：那是开发默认。正式用户需在软件里把 **`baseUrl`** 改成你的 **`https://域名`**。

**Q：CORS？**  
A：`auth-server` 已 `app.use(cors())`；若仍被浏览器拦，检查是否混用 `http`/`https` 或自定义浏览器限制。

**Q：能否只开 3721 不用 Nginx？**  
A：可以短期测试，**生产不建议**：无 HTTPS、口令与授权码易被窃听。

**Q：多机负载均衡？**  
A：需共享同一份 **`auth-db.json` 与 templates 目录**（如 NFS、对象存储 + 改造读写），否则各节点数据不一致。单机足够多数小团队。

---

## 12. 与本机开发对照

| 场景 | 命令 / 地址 |
|------|-------------|
| 本机开发 | `cd FLOWID && npm run auth:dev` → `http://127.0.0.1:3721` |
| 生产 | systemd + Nginx → `https://你的域名` |

更多接口列表见 `server/public/index.html` 或仓库内 `auth-server.cjs` 路由注册。
