/* Throwaway certificate chain for tests and the verify gate: a self-signed
   "WWDR" CA and a pass-signing certificate issued by it. Lets the whole
   .pkpass signing path run without real Apple credentials. Never used in production. */
import crypto from 'node:crypto'
import forge from 'node-forge'

function cert({ subject, issuer, publicKeyPem, signingKeyPem, ca }) {
  const c = forge.pki.createCertificate()
  c.publicKey = forge.pki.publicKeyFromPem(publicKeyPem)
  c.serialNumber = crypto.randomBytes(8).toString('hex')
  c.validity.notBefore = new Date(Date.now() - 86_400_000)
  c.validity.notAfter = new Date(Date.now() + 365 * 86_400_000)
  c.setSubject([{ name: 'commonName', value: subject }])
  c.setIssuer([{ name: 'commonName', value: issuer }])
  c.setExtensions([{ name: 'basicConstraints', cA: ca }])
  c.sign(forge.pki.privateKeyFromPem(signingKeyPem), forge.md.sha256.create())
  return forge.pki.certificateToPem(c)
}

export function testAppleCredentials() {
  const keys = () =>
    crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
  const ca = keys()
  const signer = keys()
  const wwdrPem = cert({ subject: 'Test WWDR', issuer: 'Test WWDR', publicKeyPem: ca.publicKey, signingKeyPem: ca.privateKey, ca: true })
  const certPem = cert({
    subject: 'Pass Type ID: pass.test.points',
    issuer: 'Test WWDR',
    publicKeyPem: signer.publicKey,
    signingKeyPem: ca.privateKey,
    ca: false,
  })
  return {
    passTypeId: 'pass.test.points',
    teamId: 'TESTTEAM01',
    certPem,
    keyPem: signer.privateKey,
    keyPassphrase: '',
    wwdrPem,
    apnsHost: 'https://127.0.0.1:9',
  }
}
