import { RedisNotificationRealtimePusher } from '../../../../src/modules/notifications/infrastructure/adapters/outbound/realtime/RedisNotificationRealtimePusher.js';
import type { RedisRealtimeChannel } from '../../../../src/modules/notifications/infrastructure/adapters/outbound/realtime/RedisRealtimeChannel.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';

const ORG_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';

function buildFakeChannel(publish: jest.Mock): RedisRealtimeChannel {
  return { publish } as unknown as RedisRealtimeChannel;
}

describe('RedisNotificationRealtimePusher', () => {
  it('send() calls channel.publish with the JSON-shaped message', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const pusher = new RedisNotificationRealtimePusher(buildFakeChannel(publish));

    await pusher.send({
      organizationId: createOrganizationId(ORG_ID),
      recipientUserId: createUserId(USER_ID),
      alertType: 'CASE_ASSIGNED',
      context: { caseId: 'c1' },
    });

    expect(publish).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      userId: USER_ID,
      alertType: 'CASE_ASSIGNED',
      context: { caseId: 'c1' },
    });
  });

  it('propagates a channel.publish rejection (does not swallow) so SendNotification can catch it', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('redis down'));
    const pusher = new RedisNotificationRealtimePusher(buildFakeChannel(publish));

    await expect(
      pusher.send({
        organizationId: createOrganizationId(ORG_ID),
        recipientUserId: createUserId(USER_ID),
        alertType: 'CASE_ASSIGNED',
        context: {},
      }),
    ).rejects.toThrow('redis down');
  });
});
