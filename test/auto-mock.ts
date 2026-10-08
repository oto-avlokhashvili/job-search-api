/**
 * For Test.createTestingModule(...).useMocker(autoMock): every dependency a test
 * doesn't provide itself (repositories, ConfigService, queues, other services)
 * becomes an object whose methods are jest.fn() stubs.
 */
export const autoMock = () =>
  new Proxy({} as Record<string | symbol, unknown>, {
    // 'then' stays undefined so the mock isn't mistaken for a Promise.
    get: (target, prop) => (prop === 'then' ? undefined : (target[prop] ??= jest.fn())),
  });
