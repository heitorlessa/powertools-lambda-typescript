/**
 * Test metrics middleware
 *
 * @group unit/metrics/middleware
 */
import { Metrics, MetricUnit } from '../../../src/index.js';
import { logMetrics } from '../../../src/middleware/middy.js';
import middy from '@middy/core';
import { ExtraOptions } from '../../../src/types/index.js';
import { cleanupMiddlewares } from '@aws-lambda-powertools/commons';
import context from '@aws-lambda-powertools/testing-utils/context';

jest.mock('node:console', () => ({
  ...jest.requireActual('node:console'),
  Console: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
  })),
}));
jest.spyOn(console, 'warn').mockImplementation(() => ({}));
const mockDate = new Date(1466424490000);
jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

describe('Middy middleware', () => {
  const ENVIRONMENT_VARIABLES = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ENVIRONMENT_VARIABLES };
  });

  const event = {
    foo: 'bar',
    bar: 'baz',
  };

  describe('throwOnEmptyMetrics', () => {
    test('should throw on empty metrics if set to true', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const handler = middy(async (): Promise<void> => undefined).use(
        logMetrics(metrics, { throwOnEmptyMetrics: true })
      );

      await expect(handler(event, context)).rejects.toThrowError(
        'The number of metrics recorded must be higher than zero'
      );
    });

    test('should not throw on empty metrics if set to false', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const handler = middy(async (): Promise<void> => undefined).use(
        logMetrics(metrics, { throwOnEmptyMetrics: false })
      );

      // Act & Assess
      await expect(handler(event, context)).resolves.not.toThrowError();
    });

    test('should not throw on empty metrics if not set, but should log a warning', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const handler = middy(async (): Promise<void> => undefined).use(
        logMetrics([metrics])
      );

      // Act & Assess
      await expect(handler(event, context)).resolves.not.toThrowError();
      expect(consoleWarnSpy).toBeCalledTimes(1);
      expect(consoleWarnSpy).toBeCalledWith(
        'No application metrics to publish. The cold-start metric may be published if enabled. If application metrics should never be empty, consider using `throwOnEmptyMetrics`'
      );
    });
  });

  describe('captureColdStartMetric', () => {
    test('should capture cold start metric if set to true', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const consoleSpy = jest
        .spyOn(metrics['console'], 'log')
        .mockImplementation();
      // Monkey patch the singleMetric method to return the metrics instance
      // so that we can assert on the console output
      jest.spyOn(metrics, 'singleMetric').mockImplementation(() => metrics);

      const handler = middy(async (): Promise<void> => undefined).use(
        logMetrics(metrics, { captureColdStartMetric: true })
      );

      // Act
      await handler(event, context);
      await handler(event, context);

      // Assess
      const loggedData = [
        JSON.parse(consoleSpy.mock.calls[0][0]),
        JSON.parse(consoleSpy.mock.calls[1][0]),
      ];
      expect(consoleSpy).toBeCalledTimes(2);
      expect(loggedData[0]._aws.CloudWatchMetrics[0].Metrics.length).toBe(1);
      expect(loggedData[0]._aws.CloudWatchMetrics[0].Metrics[0].Name).toBe(
        'ColdStart'
      );
      expect(loggedData[0]._aws.CloudWatchMetrics[0].Metrics[0].Unit).toBe(
        'Count'
      );
      expect(loggedData[0].ColdStart).toBe(1);
    });

    test('should not capture cold start metrics if set to false', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const consoleSpy = jest
        .spyOn(metrics['console'], 'log')
        .mockImplementation();
      // Monkey patch the singleMetric method to return the metrics instance
      // so that we can assert on the console output
      jest.spyOn(metrics, 'singleMetric').mockImplementation(() => metrics);
      const handler = middy(async (): Promise<void> => undefined).use(
        logMetrics(metrics, { captureColdStartMetric: false })
      );

      // Act
      await handler(event, context);

      // Assess
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][0]);

      expect(loggedData._aws.CloudWatchMetrics[0].Metrics.length).toBe(0);
    });

    test('should not throw on empty metrics if not set', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const handler = middy(async (): Promise<void> => undefined).use(
        logMetrics(metrics)
      );

      // Act & Assess
      await expect(handler(event, context)).resolves.not.toThrow();
    });
  });

  describe('logMetrics', () => {
    test('when a metrics instance receive multiple metrics with the same name, it prints multiple values in an array format', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const cosoleSpy = jest.spyOn(metrics['console'], 'log');
      const handler = middy(async (): Promise<void> => {
        metrics.addMetric('successfulBooking', MetricUnit.Count, 2);
        metrics.addMetric('successfulBooking', MetricUnit.Count, 1);
      }).use(logMetrics(metrics));

      // Act
      await handler(event, context);

      // Assess
      expect(cosoleSpy).toHaveBeenNthCalledWith(
        1,
        JSON.stringify({
          _aws: {
            Timestamp: 1466424490000,
            CloudWatchMetrics: [
              {
                Namespace: 'serverlessAirline',
                Dimensions: [['service']],
                Metrics: [{ Name: 'successfulBooking', Unit: 'Count' }],
              },
            ],
          },
          service: 'orders',
          successfulBooking: [2, 1],
        })
      );
    });

    test('when a metrics instance is passed WITH custom options, it prints the metrics in the stdout', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const consoleSpy = jest.spyOn(metrics['console'], 'log');
      const metricsOptions: ExtraOptions = {
        throwOnEmptyMetrics: true,
        defaultDimensions: { environment: 'prod', aws_region: 'eu-west-1' },
        captureColdStartMetric: true,
      };
      const handler = middy(async (): Promise<void> => {
        metrics.addMetric('successfulBooking', MetricUnit.Count, 1);
      }).use(logMetrics(metrics, metricsOptions));

      // Act
      await handler(event, context);

      // Assess
      expect(consoleSpy).toHaveBeenNthCalledWith(
        1,
        JSON.stringify({
          _aws: {
            Timestamp: 1466424490000,
            CloudWatchMetrics: [
              {
                Namespace: 'serverlessAirline',
                Dimensions: [['service', 'environment', 'aws_region']],
                Metrics: [{ Name: 'successfulBooking', Unit: 'Count' }],
              },
            ],
          },
          service: 'orders',
          environment: 'prod',
          aws_region: 'eu-west-1',
          successfulBooking: 1,
        })
      );
    });

    test('when a metrics instance is passed WITHOUT custom options, it prints the metrics in the stdout', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const consoleSpy = jest.spyOn(metrics['console'], 'log');
      const handler = middy(async (): Promise<void> => {
        metrics.addMetric('successfulBooking', MetricUnit.Count, 1);
      }).use(logMetrics(metrics));

      // Act
      await handler(event, context);

      // Assess
      expect(consoleSpy).toHaveBeenNthCalledWith(
        1,
        JSON.stringify({
          _aws: {
            Timestamp: 1466424490000,
            CloudWatchMetrics: [
              {
                Namespace: 'serverlessAirline',
                Dimensions: [['service']],
                Metrics: [{ Name: 'successfulBooking', Unit: 'Count' }],
              },
            ],
          },
          service: 'orders',
          successfulBooking: 1,
        })
      );
    });

    test('when an array of Metrics instances is passed, it prints the metrics in the stdout', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const consoleSpy = jest.spyOn(metrics['console'], 'log');
      const handler = middy(async (): Promise<void> => {
        metrics.addMetric('successfulBooking', MetricUnit.Count, 1);
      }).use(
        logMetrics(metrics, {
          throwOnEmptyMetrics: true,
        })
      );

      // Act
      await handler(event, context);

      // Assess
      expect(consoleSpy).toHaveBeenNthCalledWith(
        1,
        JSON.stringify({
          _aws: {
            Timestamp: 1466424490000,
            CloudWatchMetrics: [
              {
                Namespace: 'serverlessAirline',
                Dimensions: [['service']],
                Metrics: [{ Name: 'successfulBooking', Unit: 'Count' }],
              },
            ],
          },
          service: 'orders',
          successfulBooking: 1,
        })
      );
    });

    test('when enabled, and another middleware returns early, it still publishes the metrics at the end of the execution', async () => {
      // Prepare
      const metrics = new Metrics({
        namespace: 'serverlessAirline',
        serviceName: 'orders',
      });
      const publishStoredMetricsSpy = jest.spyOn(
        metrics,
        'publishStoredMetrics'
      );
      const myCustomMiddleware = (): middy.MiddlewareObj => {
        const before = async (
          request: middy.Request
        ): Promise<undefined | string> => {
          // Return early on the second invocation
          if (request.event.idx === 1) {
            // Cleanup Powertools resources
            await cleanupMiddlewares(request);

            // Then return early
            return 'foo';
          }
        };

        return {
          before,
        };
      };
      const handler = middy(
        (_event: { foo: string; bar: string } & { idx: number }): void => {
          metrics.addMetric('successfulBooking', MetricUnit.Count, 1);
        }
      )
        .use(logMetrics(metrics))
        .use(myCustomMiddleware());

      // Act
      await handler({ ...event, idx: 0 }, context);
      await handler({ ...event, idx: 1 }, context);

      // Assess
      expect(publishStoredMetricsSpy).toBeCalledTimes(2);
    });
  });
});
