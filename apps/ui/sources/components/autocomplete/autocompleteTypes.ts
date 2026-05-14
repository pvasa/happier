import type * as React from 'react';

export type AutocompleteStructuredInput =
    | Readonly<{
        kind: 'vendorPlugin';
        vendorPluginRef: string;
        label?: string;
        backendId?: string;
        agentId?: string;
    }>
    | Readonly<{
        kind: 'skill';
        name: string;
        path?: string;
        displayName?: string;
        description?: string;
        origin?: string;
        projectionKind?: string;
    }>;

export type AutocompleteSuggestion = Readonly<{
    key: string;
    text: string;
    label?: string;
    description?: string;
    component?: React.ElementType;
    rowHeight?: number;
    structuredInput?: AutocompleteStructuredInput;
}>;
