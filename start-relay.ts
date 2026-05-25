#!/usr/bin/env node

import { Relay } from './src/relay';
import selfsigned from 'selfsigned';
import * as fs from 'fs';
import * as path from 'path';

const CERT_DIR = path.join('.adp', 'certs');
const CERT_FILE = path.join(CERT_DIR, 'server.crt');
const KEY_FILE = path.join(CERT_DIR, 'server.key');

interface CertStatus {
  expired: boolean;
  expiringSoon: boolean;
  daysLeft: number;
  expiryDate: Date | null;
}

// 解析 PEM 证书获取过期时间
function getCertExpiry(certPem: string): Date | null {
  try {
    // 使用 openssl 解析证书有效期
    const x509 = new (require('node:crypto').X509Certificate)(certPem);
    return x509.validTo ? new Date(x509.validTo) : null;
  } catch {
    return null;
  }
}

// 检查证书状态
function checkCertStatus(certPem: string, warningDays = 30): CertStatus {
  const expiryDate = getCertExpiry(certPem);
  if (!expiryDate) {
    return { expired: false, expiringSoon: false, daysLeft: Infinity, expiryDate: null };
  }

  const now = new Date();
  const daysLeft = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return {
    expired: daysLeft < 0,
    expiringSoon: daysLeft >= 0 && daysLeft <= warningDays,
    daysLeft,
    expiryDate,
  };
}

// 读取已有证书
function loadExistingCert(): { cert: string; key: string; status: CertStatus } | null {
  if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
    return null;
  }

  const cert = fs.readFileSync(CERT_FILE, 'utf8');
  const key = fs.readFileSync(KEY_FILE, 'utf8');
  const status = checkCertStatus(cert);

  return { cert, key, status };
}

// 生成新证书
function generateNewCert(): { cert: string; key: string } {
  console.log('🔐 生成自签名 TLS 证书...');
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, { algorithm: 'sha256', days: 365, keySize: 2048 });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CERT_FILE, pems.cert.toString());
  fs.writeFileSync(KEY_FILE, pems.private.toString());

  console.log(`📁 证书已保存到 ${CERT_DIR}/`);
  return { cert: pems.cert.toString(), key: pems.private.toString() };
}

function ensureTls(): { cert: string; key: string } | undefined {
  // ADP_TLS=false 时禁用 TLS，默认启用
  if (process.env.ADP_TLS === 'false') {
    console.log('ℹ️  ADP_TLS=false，TLS 已禁用');
    return undefined;
  }

  const tlsCert = process.env.ADP_TLS_CERT;
  const tlsKey = process.env.ADP_TLS_KEY;

  // 优先使用环境变量指定的证书 (不做自动续期，只提示)
  if (tlsCert && tlsKey) {
    const cert = fs.readFileSync(tlsCert, 'utf8');
    const key = fs.readFileSync(tlsKey, 'utf8');
    const status = checkCertStatus(cert);

    if (status.expiryDate) {
      console.log(`⚠️  使用外部证书: ${tlsCert}`);
      console.log(`   证书到期: ${status.expiryDate.toLocaleDateString()} (剩余 ${status.daysLeft} 天)`);
      if (status.expiringSoon) {
        console.log(`   ⚡ 警告: 证书将在 ${status.daysLeft} 天后过期，请及时更新！`);
      }
    }
    return { cert, key };
  }

  // 检查已存在的证书
  const existing = loadExistingCert();
  if (existing) {
    const { cert, key, status } = existing;

    if (status.expired) {
      console.log('⚠️  证书已过期，正在重新生成...');
      return generateNewCert();
    }

    if (status.expiringSoon) {
      console.log(`⚠️  证书将在 ${status.daysLeft} 天后过期 (${status.expiryDate?.toLocaleDateString()})`);

      if (process.env.ADP_AUTO_RENEW === 'true') {
        console.log('🔄  ADP_AUTO_RENEW=true，自动续期...');
        return generateNewCert();
      }
      console.log('   删除 .adp/certs/ 可重新生成');
    } else {
      console.log(`ℹ️  使用已有证书，到期: ${status.expiryDate?.toLocaleDateString()} (剩余 ${status.daysLeft} 天)`);
    }

    return { cert, key };
  }

  // 生成新证书
  console.log('🔐 生成自签名 TLS 证书...');
  return generateNewCert();
}

const port = parseInt(process.env.ADP_RELAY_PORT || process.env.RELAY_PORT || '9700', 10);
const host = process.env.ADP_RELAY_HOST || process.env.RELAY_HOST || '0.0.0.0';
const maxConnections = parseInt(process.env.ADP_RELAY_MAX_CONNECTIONS || process.env.RELAY_MAX_CONNECTIONS || '10000', 10);
const heartbeatIntervalMs = parseInt(process.env.ADP_RELAY_HEARTBEAT_INTERVAL_MS || process.env.RELAY_HEARTBEAT_INTERVAL_MS || '15000', 10);
const heartbeatTimeoutMs = parseInt(process.env.ADP_RELAY_HEARTBEAT_TIMEOUT_MS || process.env.RELAY_HEARTBEAT_TIMEOUT_MS || '45000', 10);
const offlineMaxAgeMs = parseInt(process.env.ADP_RELAY_OFFLINE_MAX_AGE_MS || process.env.RELAY_OFFLINE_MAX_AGE_MS || '86400000', 10);
const offlineMaxPerAgent = parseInt(process.env.ADP_RELAY_OFFLINE_MAX_PER_AGENT || process.env.RELAY_OFFLINE_MAX_PER_AGENT || '500', 10);

const tls = ensureTls();
const protocol = tls ? 'wss' : 'ws';

const relay = new Relay({
  port,
  host,
  maxConnections,
  heartbeatIntervalMs,
  heartbeatTimeoutMs,
  offlineMaxAgeMs,
  offlineMaxPerAgent,
  tls,
  onCertExpiringSoon: (daysLeft: number, expiryDate: Date) => {
    console.log(`\n⚠️  证书将在 ${daysLeft} 天后过期 (${expiryDate.toLocaleDateString()})`);
    if (process.env.ADP_AUTO_RENEW === 'true') {
      console.log('🔄  ADP_AUTO_RENEW=true，自动续期...');
      const renewed = generateNewCert();
      relay.updateTls(renewed.cert, renewed.key);
      console.log(`✅  证书已热更新`);
    } else {
      console.log('   设置 ADP_AUTO_RENEW=true 启用自动续期');
      console.log('   或重启服务重新生成证书');
    }
  },
});

console.log(`
╔══════════════════════════════════════╗
║        ADP Relay Server              ║
╠══════════════════════════════════════╣
║  ${protocol}://${host}:${port}/adp/relay       ║
║                                      ║
║  Heartbeat: ${heartbeatIntervalMs / 1000}s / Timeout: ${heartbeatTimeoutMs / 1000}s       ║
║  Offline cache: ${offlineMaxAgeMs / 86400000}d / ${offlineMaxPerAgent} msgs       ║
╚══════════════════════════════════════╝
`);

process.on('SIGINT', () => {
  console.log('\n👋 Relay shutting down...');
  relay.close();
  process.exit(0);
});