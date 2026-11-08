# Source-checkout examples

For a first installation, use the [packaged Quickstart](../dsh-plugin/QUICKSTART.md).
The examples below support source development, compatibility checks and retained
research drivers. They are separate from the examples shipped in the npm package.

| Need | Entry |
| --- | --- |
| Shipped deterministic product examples | [Product examples](../dsh-plugin/examples/product/README.md) |
| Shipped grounded-QA task | [Real-task starter](../dsh-plugin/QUICKSTART.md#real-task-starter) |
| Shipped bounded decision example | [Decision preparation](../dsh-plugin/examples/decisions/prepare.mjs) |
| Native adapter and profile controls | [native/](native/), used by [product verifiers](../scripts/README.md) |
| Fact evaluation and configured Caller | [Fact task](native/fact-task.md), [Caller resources](native/calling-facts.md) |
| Ordered evidence and warm history | [Ordered stages](native/ordered-stages.md), [warm start](native/warm-start.md) |
| Bounded configuration adapter | [Fetch configuration](native/FETCH_CONFIG.md) |
| Retained Python adapter | [agent_native/](agent_native/); the default product runtime is JavaScript |

A profile builder may copy these files beside a host driver so its local imports
resolve in an isolated profile. For example, the native verifier stages
`native/adoption.js`, and the maturation Caller builder stages
`native/schema-answer-evaluator.js`. Their source drivers are not standalone
entry points before staging.

Some examples require model access and a frozen experiment contract. Follow the
named guide's scope and the owner's current authorization. Source fixtures and
historical final inputs are exposed test data, not independent unseen evidence.
