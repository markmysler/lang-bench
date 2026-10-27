export interface DomainEvent {
  id: string;
  type: 'task.created' | 'task.updated' | 'comment.added' | 'project.archived';
  accountId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}
