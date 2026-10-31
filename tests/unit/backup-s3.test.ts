import { describe, expect, it } from 'vitest';
import { canonicalQuery, objectUrl, prefixFromLocation, presignUrl, s3ConfigFromEnv, signingKey, signRequest, uriEncode } from '@/lib/backup/s3';

/* Vectors from AWS documentation (Signature Version 4 test suite + Amazon S3 "Authenticating Requests" examples). */
const S3_EXAMPLE = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const SUITE = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };

describe('SigV4 signer (lib/backup/s3)', () => {
  it('derives the signing key (IAM docs example)', () => {
    expect(signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam').toString('hex')).toBe(
      'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d',
    );
  });

  it('signs get-vanilla (aws-sig-v4-test-suite)', () => {
    const h = signRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      credentials: SUITE,
      region: 'us-east-1',
      service: 'service',
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('signs the S3 "GET Object" header example', () => {
    const h = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      credentials: S3_EXAMPLE,
      region: 'us-east-1',
      now: new Date('2013-05-24T00:00:00Z'),
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('presigns the S3 query-string example (24 h)', () => {
    const url = presignUrl({
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      credentials: S3_EXAMPLE,
      region: 'us-east-1',
      expiresIn: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request');
    expect(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')).toBe(true);
  });

  it('encodes per RFC 3986 and sorts the query', () => {
    expect(uriEncode("a b/c*!'()~")).toBe('a%20b%2Fc%2A%21%27%28%29~');
    expect(canonicalQuery([['b', '2'], ['a', 'x y'], ['a', '1']])).toBe('a=1&a=x%20y&b=2');
  });

  it('builds path-style URLs for custom endpoints and virtual-hosted for AWS', () => {
    expect(objectUrl({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'bk', region: 'auto' }, 'BK-1/db data.sql')).toBe(
      'https://acc.r2.cloudflarestorage.com/bk/BK-1/db%20data.sql',
    );
    expect(objectUrl({ endpoint: null, bucket: 'bk', region: 'eu-west-1' }, '/x/y')).toBe('https://bk.s3.eu-west-1.amazonaws.com/x/y');
    expect(prefixFromLocation('s3://bk/BK-2026-1101-0200/')).toBe('BK-2026-1101-0200');
    expect(prefixFromLocation('s3://other/BK-1', 'bk')).toBeNull();
  });

  it('reads config from env (null when incomplete)', () => {
    expect(s3ConfigFromEnv({ BACKUP_S3_BUCKET: 'b' })).toBeNull();
    expect(s3ConfigFromEnv({ BACKUP_S3_BUCKET: 'b', BACKUP_S3_ACCESS_KEY_ID: 'k', BACKUP_S3_SECRET_ACCESS_KEY: 's', BACKUP_S3_ENDPOINT: 'https://e/' })).toMatchObject({
      endpoint: 'https://e',
      region: 'auto',
    });
  });
});
