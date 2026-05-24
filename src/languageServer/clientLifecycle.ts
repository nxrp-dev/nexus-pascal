export class ClientLifecycleLock {
    private currentOperation: Promise<void> = Promise.resolve();

    public async run(operation: () => Promise<void>): Promise<void> {
        const previousOperation = this.currentOperation;
        let release: () => void;
        this.currentOperation = new Promise(resolve => release = resolve);

        await previousOperation;
        try {
            await operation();
        } finally {
            release!();
        }
    }
}
