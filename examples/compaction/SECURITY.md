# Security & Compliance

## Redaction & PII Protection

### Enabled by Default

Compaction redacts sensitive data **before** export to storage or Ariadne:

```python
# Before:
"api_key = sk-abc123def456"

# After:
"api_key = [REDACTED]"
```

### Built-in Patterns

- API keys: `(?i)api[_-]?key\s*[:=]\s*\S+`
- Passwords: `(?i)password\s*[:=]\s*\S+`
- Tokens: `(?i)token\s*[:=]\s*\S+`
- Secrets: `(?i)secret\s*[:=]\s*\S+`

### Custom Patterns

```yaml
redaction:
  enabled: true
  patterns:
    - '(?i)credit[_-]?card\s*[:=]\s*\d{4}-\d{4}-\d{4}-\d{4}'
    - '(?i)ssn\s*[:=]\s*\d{3}-\d{2}-\d{4}'
```

### Programmatic Redaction

```python
from compact.adapters import FileStorageAdapter

adapter = FileStorageAdapter(
    redaction_patterns=[
        r'(?i)auth[_-]?token\s*[:=]\s*\S+',
        r'customer[_-]?id:\s*\d+',
    ]
)
```

## Non-blocking Telemetry

### Safe by Default

- **Timeout**: HTTP exports to Ariadne timeout after 2 seconds
- **Non-blocking**: Errors logged but never raise exceptions
- **Batched**: Events flushed together for efficiency

```python
exporter = AriadneExporter(
    ariadne_url="http://localhost:5175/ingest",
    timeout=2.0  # Never blocks >2s
)
```

### Error Handling

```
[Ariadne] Failed to export events: Connection refused
→ Continues without failing
```

## Protected Memory

### Explicit Controls

Mark critical messages that must never be pruned:

```python
from compact import mark_protected

policy = mark_protected(
    "POLICY: PCI DSS Compliance - No credit card data in logs",
    label="Compliance Policy"
)
messages.insert(0, policy)
```

### System Roles

System and developer messages are **always** protected:

```python
Message(role="system", content="You are a payment processor")
# ↑ Always preserved, never pruned
```

## Storage Security

### Filesystem Adapter

- Files stored locally in `.compact/archive/`
- File permissions inherited from parent directory
- Redaction applied before writing

```python
from compact.adapters import FileStorageAdapter

adapter = FileStorageAdapter(
    base_path="/secure/archive",  # Ensure proper permissions
    redaction_enabled=True
)
```

### S3 Adapter (Optional)

Enable encryption and IAM-based access:

```python
# Via environment
export COMPACT_STORAGE_ADAPTER=s3
export COMPACT_STORAGE_BUCKET=my-secure-bucket
export AWS_REGION=us-east-1
# Uses IAM role, no hardcoded credentials
```

KMS encryption supported:

```yaml
storage:
  adapter: "s3"
  bucket: "my-bucket"
  kms_key_id: "arn:aws:kms:us-east-1:123456789012:key/12345678"
```

## Audit Logging

### Event Audit Trail

All compaction events logged to `events.jsonl` with timestamps:

```json
{
  "timestamp": "2025-10-19T12:34:56Z",
  "type": "compact.trigger_decision",
  "session_id": "session-001",
  "properties": {
    "triggered": true,
    "tokens_before": 112000,
    "reason": "usage_pct >= trigger_pct"
  }
}
```

### Retention

- Filesystem: Manual cleanup (document policy)
- S3: Configure lifecycle policies

```yaml
# S3 lifecycle policy
{
  "Rules": [
    {
      "ID": "DeleteOldArchives",
      "Status": "Enabled",
      "Prefix": "compaction-archive/",
      "ExpirationInDays": 90
    }
  ]
}
```

## API Security

### No Credential Exposure

- API keys **never** logged to console
- Only exported via non-blocking HTTP (with redaction)
- Timeout prevents long-lived connections

### OPENAI_API_KEY Handling

```python
# Secure: Uses environment variable
manager = Summarizer(model="gpt-4")
# → Reads from $OPENAI_API_KEY, never logged

# Never log credentials
print(f"API Key: {api_key}")  # ✗ DON'T DO THIS
```

## Compliance Considerations

### PCI DSS

- ✅ No credit card data in logs (redaction enabled)
- ✅ Encryption for S3 storage (KMS support)
- ✅ Audit trail via event logging
- ⚠️  Review `redaction.patterns` for PCI context

### HIPAA

- ✅ Protected memory for PHI (mark as protected)
- ✅ Audit logging
- ⚠️  Ensure storage backend complies (S3 with encryption)

### GDPR

- ✅ Redaction for PII
- ✅ Right to deletion (manual cleanup)
- ⚠️  Ensure retention policies aligned with GDPR (typically 30 days max)

## Best Practices

### 1. Always Enable Redaction

```python
# ✓ Good
config = CompactConfig(redaction_enabled=True)

# ✗ Don't disable unless absolutely necessary
config = CompactConfig(redaction_enabled=False)
```

### 2. Mark Protected Messages Explicitly

```python
# ✓ Explicit is better
critical_policy = mark_protected(POLICY_TEXT, label="Policy")
messages.insert(0, critical_policy)

# ✗ Relying on roles alone
Message(role="system", content="some policy")  # Protected but unclear
```

### 3. Configure Storage Backend

```python
# ✓ Use encrypted S3
export COMPACT_STORAGE_ADAPTER=s3
export COMPACT_STORAGE_BUCKET=secure-bucket

# ✓ Use local filesystem with proper permissions
chmod 700 /secure/archive
```

### 4. Review Custom Redaction Patterns

```yaml
# ✓ Add domain-specific patterns
redaction:
  patterns:
    - 'customer_id:\s*\d+'
    - 'session_token:\s*\S+'
```

### 5. Monitor Export Failures

```python
# Check stderr for redaction errors
# [Ariadne] Failed to export events: ...
```

## Threat Model

### Threat: Credentials Leaked in Telemetry

**Mitigation**: Redaction enabled by default, custom patterns support.

### Threat: Long-Running Exports Block Agent

**Mitigation**: Timeout ≤2s, non-blocking.

### Threat: Unauthorized Storage Access

**Mitigation**: Filesystem permissions, IAM for S3, KMS encryption.

### Threat: Data Retention Compliance

**Mitigation**: Audit logging, retention policies, lifecycle rules.

## Incident Response

### Suspected Data Breach

1. **Stop exporter**: Set `COMPACT_TELEMETRY_ENABLED=false`
2. **Check logs**: Review `.compact/archive/*/events.jsonl`
3. **Cleanup**: Remove sensitive archives
4. **Audit**: Grep for unredacted patterns

```bash
grep -i "api_key\|password\|token" .compact/archive/*/transcript*.jsonl
```

### Configuration Audit

```bash
# Verify redaction enabled
grep redaction_enabled config.yaml

# Verify patterns comprehensive
grep -A5 "redaction:" config.yaml
```

## References

- [OWASP Secrets Management](https://owasp.org/www-community/attacks/Secrets_Management)
- [PCI DSS v3.2](https://www.pcisecuritystandards.org/)
- [HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html)
- [GDPR Article 25 - Data Protection by Design](https://gdpr-info.eu/art-25-gdpr/)
