import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InternalKeyGuard } from './internal-key.guard';
import { ClientIpThrottlerGuard } from './client-ip-throttler.guard';
import { FilterJobDto } from '../../job/dto/filter-job.dto';

const contextFor = (headers: Record<string, string>, ip = '10.0.0.1') =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers, ip }) }) }) as unknown as ExecutionContext;

describe('InternalKeyGuard', () => {
  const guard = new InternalKeyGuard();
  const original = process.env.INTERNAL_API_KEY;
  afterEach(() => (process.env.INTERNAL_API_KEY = original));

  it('accepts the configured key', () => {
    process.env.INTERNAL_API_KEY = 'secret-key';
    expect(guard.canActivate(contextFor({ 'x-internal-key': 'secret-key' }))).toBe(true);
  });

  it('rejects a wrong or missing key', () => {
    process.env.INTERNAL_API_KEY = 'secret-key';
    expect(() => guard.canActivate(contextFor({ 'x-internal-key': 'nope' }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextFor({}))).toThrow(UnauthorizedException);
  });

  it('rejects everything when INTERNAL_API_KEY is not configured', () => {
    delete process.env.INTERNAL_API_KEY;
    expect(() => guard.canActivate(contextFor({ 'x-internal-key': '' }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextFor({ 'x-internal-key': 'undefined' }))).toThrow(UnauthorizedException);
  });
});

describe('ClientIpThrottlerGuard', () => {
  const guard = new ClientIpThrottlerGuard([], {} as any, new Reflector()) as any;
  const original = process.env.PROXY_SHARED_SECRET;
  beforeEach(() => (process.env.PROXY_SHARED_SECRET = 'proxy-secret'));
  afterEach(() => (process.env.PROXY_SHARED_SECRET = original));

  it('uses X-Client-IP when the request comes from our proxy', async () => {
    const req = { headers: { 'x-proxy-key': 'proxy-secret', 'x-client-ip': '203.0.113.7' }, ip: '10.0.0.1' };
    expect(await guard.getTracker(req)).toBe('203.0.113.7');
  });

  it('ignores X-Client-IP without the proxy secret (no spoofing)', async () => {
    const req = { headers: { 'x-proxy-key': 'guess', 'x-client-ip': '203.0.113.7' }, ip: '10.0.0.1' };
    expect(await guard.getTracker(req)).toBe('10.0.0.1');
  });

  it('skips throttling for server-side renders only', async () => {
    expect(await guard.shouldSkip(contextFor({ 'x-proxy-key': 'proxy-secret' }))).toBe(true);
    expect(await guard.shouldSkip(contextFor({ 'x-proxy-key': 'proxy-secret', 'x-client-ip': '1.2.3.4' }))).toBe(false);
    expect(await guard.shouldSkip(contextFor({}))).toBe(false);
  });
});

describe('FilterJobDto limit', () => {
  const errorsFor = async (limit: unknown) =>
    validate(plainToInstance(FilterJobDto, { limit }, { enableImplicitConversion: true }));

  it('allows up to 50', async () => {
    expect(await errorsFor('50')).toHaveLength(0);
  });

  it('rejects anything larger', async () => {
    expect((await errorsFor('100000'))[0]?.property).toBe('limit');
  });
});
