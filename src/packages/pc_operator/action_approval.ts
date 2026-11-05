/**
 * One-use approvals issued only after the Electron main process displays a native confirmation.
 * The store binds the token to the invoking window, exact action digest and short expiry.
 */
export interface OneTimeApprovalGrant {
  senderId: number;
  actionDigest: string;
  expiresAtMs: number;
}

export class OneTimeActionApprovalVault {
  private readonly grants = new Map<string, OneTimeApprovalGrant>();

  public issue(token: string, grant: OneTimeApprovalGrant): void {
    if (!token || !Number.isInteger(grant.senderId) || !grant.actionDigest || !Number.isFinite(grant.expiresAtMs)) {
      throw new Error('APPROVAL_GRANT_INVALID');
    }
    this.prune();
    this.grants.set(token, { ...grant });
  }

  /** A token is consumed on every attempt, including mismatched/expired attempts. */
  public consume(
    token: string,
    senderId: number,
    actionDigest: string,
    nowMs = Date.now()
  ): boolean {
    const grant = this.grants.get(token);
    this.grants.delete(token);
    return Boolean(
      grant &&
      grant.expiresAtMs >= nowMs &&
      grant.senderId === senderId &&
      grant.actionDigest === actionDigest
    );
  }

  public prune(nowMs = Date.now()): void {
    for (const [token, grant] of this.grants) {
      if (grant.expiresAtMs < nowMs) this.grants.delete(token);
    }
  }

  public clear(): void {
    this.grants.clear();
  }

  public get size(): number {
    return this.grants.size;
  }
}
