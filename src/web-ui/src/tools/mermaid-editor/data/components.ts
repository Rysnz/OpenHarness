import { MermaidComponentCategory } from '../types';

type Translate = (key: string) => string;
type ComponentSpec = {
  id: string;
  nameKey: string;
  descKey: string;
  code: string;
};
type CategorySpec = {
  id: string;
  nameKey: string;
  components: ComponentSpec[];
};

const SIMPLE_FLOW_TEMPLATE = `flowchart TD
    A[Start] --> B[Process]
    B --> C{Success?}
    C -->|Yes| D[Save]
    C -->|No| E[Error]
    D --> F[End]
    E --> F`;

const AI_IDE_ARCHITECTURE_TEMPLATE = `flowchart TD
subgraph ClientLayer[Client Layer]
    A[Web IDE]
    B[Desktop App]
    C[Mobile App]
end

subgraph PresentationLayer[Presentation Layer]
    D[3D Visualization]
    E[Multimodal Interaction]
    F[Real-time Collaboration]
    G[Flow State Detection]
end

subgraph AILayer[AI Agent Layer]
    H[Coding Agent]
    I[Architecture Agent]
    J[Knowledge Agent]
    K[Collaboration Agent]
end

subgraph CoreServicesLayer[Core Services]
    L[Rule Engine]
    M[Knowledge Graph]
    N[Code Analysis]
    O[Personalization]
    P[Project Management]
    Q[Collaboration Service]
end

subgraph DataLayer[Data Layer]
    R[Knowledge Graph DB]
    S[Rule Database]
    T[User Profiles]
    U[Vector Store]
    V[Resource Library]
end

subgraph InfrastructureLayer[Infrastructure]
    W[Model Mesh]
    X[Message Bus]
    Y[Cache]
    Z[File Storage]
end

A --> D
B --> D
C --> Q
D --> H
E --> H
E --> I
F --> Q
G --> O
H --> L
H --> N
I --> L
I --> M
J --> M
K --> P
K --> Q
L --> S
M --> R
M --> U
N --> U
O --> T
O --> V
P --> S
Q --> X
W --> H
W --> I
W --> J
W --> K
X --> Y`;

const PARALLEL_FLOW_TEMPLATE = `flowchart TD
    A[Start] --> B[Fork]
    B --> C[Task 1]
    B --> D[Task 2]
    C --> E[Join]
    D --> E
    E --> F[End]`;

const CATEGORY_SPECS: CategorySpec[] = [
  {
    id: 'nodes',
    nameKey: 'componentLibrary.categories.nodes',
    components: [
      ['rect-node', 'rectNode', 'A[Node]'],
      ['round-node', 'roundNode', 'B(Node)'],
      ['circle-node', 'circleNode', 'C((Node))'],
      ['diamond-node', 'diamondNode', 'D{Node}'],
      ['hexagon-node', 'hexagonNode', 'E{{Node}}']
    ].map(([id, key, code]) => ({
      id,
      code,
      nameKey: `componentLibrary.components.${key}`,
      descKey: `componentLibrary.components.${key}Desc`
    }))
  },
  {
    id: 'connections',
    nameKey: 'componentLibrary.categories.connections',
    components: [
      ['arrow-line', 'arrowLine', 'A --> B'],
      ['labeled-arrow', 'labeledArrow', 'A -->|Label| B'],
      ['dotted-line', 'dottedLine', 'A -.-> B'],
      ['thick-line', 'thickLine', 'A ==> B'],
      ['plain-line', 'plainLine', 'A --- B']
    ].map(([id, key, code]) => ({
      id,
      code,
      nameKey: `componentLibrary.components.${key}`,
      descKey: `componentLibrary.components.${key}Desc`
    }))
  },
  {
    id: 'templates',
    nameKey: 'componentLibrary.categories.templates',
    components: [
      {
        id: 'simple-flow',
        nameKey: 'componentLibrary.components.simpleFlow',
        descKey: 'componentLibrary.components.simpleFlowDesc',
        code: SIMPLE_FLOW_TEMPLATE
      },
      {
        id: 'ai-ide-architecture',
        nameKey: 'componentLibrary.components.aiIdeArchitecture',
        descKey: 'componentLibrary.components.aiIdeArchitectureDesc',
        code: AI_IDE_ARCHITECTURE_TEMPLATE
      },
      {
        id: 'parallel-flow',
        nameKey: 'componentLibrary.components.parallelFlow',
        descKey: 'componentLibrary.components.parallelFlowDesc',
        code: PARALLEL_FLOW_TEMPLATE
      }
    ]
  }
];

const ENGLISH_FALLBACKS: Record<string, string> = {
  'componentLibrary.categories.nodes': 'Nodes',
  'componentLibrary.categories.connections': 'Connections',
  'componentLibrary.categories.templates': 'Templates',
  'componentLibrary.components.rectNode': 'Rectangle Node',
  'componentLibrary.components.rectNodeDesc': 'Basic rectangle node',
  'componentLibrary.components.roundNode': 'Rounded Rectangle',
  'componentLibrary.components.roundNodeDesc': 'Rounded rectangle node',
  'componentLibrary.components.circleNode': 'Circle Node',
  'componentLibrary.components.circleNodeDesc': 'Circle node',
  'componentLibrary.components.diamondNode': 'Diamond Node',
  'componentLibrary.components.diamondNodeDesc': 'Decision diamond node',
  'componentLibrary.components.hexagonNode': 'Hexagon Node',
  'componentLibrary.components.hexagonNodeDesc': 'Hexagon node',
  'componentLibrary.components.arrowLine': 'Arrow Connection',
  'componentLibrary.components.arrowLineDesc': 'Basic arrow connection',
  'componentLibrary.components.labeledArrow': 'Labeled Arrow',
  'componentLibrary.components.labeledArrowDesc': 'Arrow connection with label',
  'componentLibrary.components.dottedLine': 'Dotted Connection',
  'componentLibrary.components.dottedLineDesc': 'Dotted arrow connection',
  'componentLibrary.components.thickLine': 'Thick Connection',
  'componentLibrary.components.thickLineDesc': 'Thick arrow connection',
  'componentLibrary.components.plainLine': 'Plain Line',
  'componentLibrary.components.plainLineDesc': 'Plain line without arrow',
  'componentLibrary.components.simpleFlow': 'Simple Flow',
  'componentLibrary.components.simpleFlowDesc': 'Basic flowchart template with decision branch',
  'componentLibrary.components.aiIdeArchitecture': 'AI IDE Architecture',
  'componentLibrary.components.aiIdeArchitectureDesc': 'AI-driven intelligent development environment architecture',
  'componentLibrary.components.parallelFlow': 'Parallel Flow',
  'componentLibrary.components.parallelFlowDesc': 'Parallel processing flow',
};

const materializeCategory = (spec: CategorySpec, t: Translate): MermaidComponentCategory => ({
  id: spec.id,
  name: t(spec.nameKey),
  components: spec.components.map((component) => ({
    id: component.id,
    name: t(component.nameKey),
    category: spec.id,
    code: component.code,
    description: t(component.descKey)
  }))
});

export const getComponentCategories = (t: Translate): MermaidComponentCategory[] => (
  CATEGORY_SPECS.map((category) => materializeCategory(category, t))
);

export const componentCategories: MermaidComponentCategory[] = getComponentCategories(
  (key) => ENGLISH_FALLBACKS[key] || key
);
