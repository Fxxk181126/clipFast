# ClipFast Auth Proxy

Cloudflare Worker，代理 Supabase Auth 请求并隐藏 anon key。

## 部署

```bash
cd worker
npm install

# 设置 secrets
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY

# （可选）启用 KV 限流
npx wrangler kv namespace create RATE_LIMIT
# 把返回的 id 填入 wrangler.toml 的 kv_namespaces 配置

npm run deploy
```

## 本地开发

```bash
cd worker
echo "SUPABASE_URL=https://your-project.supabase.co" >> .dev.vars
echo "SUPABASE_ANON_KEY=your-anon-key" >> .dev.vars
npm run dev
```

Worker 会在 `http://localhost:8787/auth/v1/*` 转发到 Supabase。
