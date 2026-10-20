import Phaser from 'phaser';

/**
 * Messages between the game and the HTML panels:
 *   agents (AgentView[]), approvals (ApprovalView[]), shipped (number), hire:full
 *   select (id), hire, approval:resolve ({ id, ok }), autoapprove (boolean)
 */
export const bus = new Phaser.Events.EventEmitter();
