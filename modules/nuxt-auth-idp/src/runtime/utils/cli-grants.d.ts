import type { OpenApeAuthorizationDetail, OpenApeCliAuthorizationDetail } from '@openape/core';
export declare function getCliAuthorizationDetails(details?: OpenApeAuthorizationDetail[]): OpenApeCliAuthorizationDetail[];
export declare function formatCliResourceChain(detail: OpenApeCliAuthorizationDetail): string;
export declare function summarizeCliGrant(details?: OpenApeAuthorizationDetail[]): string | null;
