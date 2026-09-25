# The Agon MCP tools

**Generated from the frozen contracts by `scripts/mcp-docs.mjs`. Never hand-edit it.** The
schemas below are the same ones the server validates against, so this page cannot describe a
shape the server does not accept.

Four tools, and the list is stable: an agent's prompt cache is keyed on it, so adding or
reordering one costs every user a cache miss.

## `get_report`

Reads a wallet and returns its trading profile: the rules it actually follows, what breaking them cost, and what share of its swaps the numbers are based on.

Response budget: **2,000 tokens**, enforced in CI.

**Input**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    }
  },
  "required": [
    "wallet"
  ]
}
```

**Output**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "range": {
      "type": "object",
      "properties": {
        "readTransactions": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "estimatedTotal": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            },
            {
              "type": "null"
            }
          ]
        },
        "throughSlot": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "complete": {
          "type": "boolean"
        },
        "stoppedBecause": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "readTransactions",
        "estimatedTotal",
        "throughSlot",
        "complete",
        "stoppedBecause"
      ],
      "additionalProperties": false
    },
    "metrics": {
      "type": "object",
      "properties": {
        "closedTrades": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "medianSize": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$"
        },
        "medianHoldSeconds": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "realisedPnl": {
          "type": "string",
          "pattern": "^-?(0|[1-9][0-9]*)$"
        }
      },
      "required": [
        "closedTrades",
        "medianSize",
        "medianHoldSeconds",
        "realisedPnl"
      ],
      "additionalProperties": false
    },
    "rules": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "stop",
              "size",
              "hold"
            ]
          },
          "found": {
            "type": "boolean"
          },
          "value": {
            "type": [
              "number",
              "null"
            ]
          },
          "sampleSize": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "requiredSampleSize": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "reason": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "kind",
          "found",
          "value",
          "sampleSize",
          "requiredSampleSize",
          "reason"
        ],
        "additionalProperties": false
      }
    },
    "exceptions": {
      "type": "object",
      "properties": {
        "count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "cost": {
          "type": "string",
          "pattern": "^-?(0|[1-9][0-9]*)$"
        }
      },
      "required": [
        "count",
        "cost"
      ],
      "additionalProperties": false
    },
    "coverage": {
      "type": "object",
      "properties": {
        "decodedSwaps": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "totalSwaps": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "share": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        }
      },
      "required": [
        "decodedSwaps",
        "totalSwaps",
        "share"
      ],
      "additionalProperties": false
    },
    "unsupported": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "programId": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          },
          "count": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "reason": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "programId",
          "count",
          "reason"
        ],
        "additionalProperties": false
      }
    },
    "dataSlot": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "ruleVersion": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "wallet",
    "range",
    "metrics",
    "rules",
    "exceptions",
    "coverage",
    "unsupported",
    "dataSlot",
    "ruleVersion"
  ],
  "additionalProperties": false
}
```

## `check_trade`

Answers whether one proposed trade fits that profile. Arithmetic first, and every reason carries the rule that produced it.

Response budget: **400 tokens**, enforced in CI.

**Input**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "mint": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "side": {
      "type": "string",
      "enum": [
        "buy",
        "sell"
      ]
    },
    "size": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$"
    },
    "wallet": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    }
  },
  "required": [
    "mint",
    "side",
    "size",
    "wallet"
  ]
}
```

**Output**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "verdict": {
      "type": "string",
      "enum": [
        "pass",
        "block",
        "unsure"
      ]
    },
    "reasons": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "rule": {
            "type": "string",
            "minLength": 1
          },
          "message": {
            "type": "string",
            "minLength": 1
          },
          "observed": {
            "type": "number"
          },
          "limit": {
            "type": "number"
          },
          "unit": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "rule",
          "message"
        ],
        "additionalProperties": false
      }
    },
    "dataSlot": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "ruleVersion": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "verdict",
    "reasons",
    "dataSlot",
    "ruleVersion"
  ],
  "additionalProperties": false
}
```

## `arm_rule`

Turns a rule into an on-chain cap the agent has to trade inside. The user signs; the key never leaves their wallet.

**Input**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "mints": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
      }
    },
    "cap": {
      "type": "object",
      "properties": {
        "mint": {
          "type": "string",
          "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
        },
        "amount": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$"
        },
        "windowSeconds": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "mint",
        "amount",
        "windowSeconds"
      ]
    },
    "triggerType": {
      "type": "string",
      "enum": [
        "stop",
        "trailing-stop",
        "take-profit",
        "balance",
        "event"
      ]
    },
    "expiresAt": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "mints",
    "cap",
    "triggerType",
    "expiresAt"
  ]
}
```

**Output**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "spec": {
      "type": "object",
      "properties": {
        "mints": {
          "minItems": 1,
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          }
        },
        "cap": {
          "type": "object",
          "properties": {
            "mint": {
              "type": "string",
              "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
            },
            "amount": {
              "type": "string",
              "pattern": "^(0|[1-9][0-9]*)$"
            },
            "windowSeconds": {
              "type": "integer",
              "exclusiveMinimum": 0,
              "maximum": 9007199254740991
            }
          },
          "required": [
            "mint",
            "amount",
            "windowSeconds"
          ],
          "additionalProperties": false
        },
        "triggerType": {
          "type": "string",
          "enum": [
            "stop",
            "trailing-stop",
            "take-profit",
            "balance",
            "event"
          ]
        },
        "expiresAt": {
          "anyOf": [
            {
              "type": "string",
              "format": "date-time",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "mints",
        "cap",
        "triggerType",
        "expiresAt"
      ],
      "additionalProperties": false
    },
    "swigRole": {
      "type": "object",
      "properties": {
        "roleId": {
          "type": "string",
          "minLength": 1
        },
        "authority": {
          "type": "string",
          "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
        },
        "program": {
          "type": "string",
          "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
        },
        "tokenRecurringLimit": {
          "type": "object",
          "properties": {
            "mint": {
              "type": "string",
              "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
            },
            "amount": {
              "type": "string",
              "pattern": "^(0|[1-9][0-9]*)$"
            },
            "windowSeconds": {
              "type": "integer",
              "exclusiveMinimum": 0,
              "maximum": 9007199254740991
            }
          },
          "required": [
            "mint",
            "amount",
            "windowSeconds"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "roleId",
        "authority",
        "program",
        "tokenRecurringLimit"
      ],
      "additionalProperties": false
    },
    "jupiterOrderId": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "spec",
    "swigRole",
    "jupiterOrderId"
  ],
  "additionalProperties": false
}
```

## `list_rules`

Lists the caps currently armed for a wallet.

**Input**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    }
  },
  "required": [
    "wallet"
  ]
}
```

**Output**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "spec": {
        "type": "object",
        "properties": {
          "mints": {
            "minItems": 1,
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
            }
          },
          "cap": {
            "type": "object",
            "properties": {
              "mint": {
                "type": "string",
                "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
              },
              "amount": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              "windowSeconds": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "mint",
              "amount",
              "windowSeconds"
            ],
            "additionalProperties": false
          },
          "triggerType": {
            "type": "string",
            "enum": [
              "stop",
              "trailing-stop",
              "take-profit",
              "balance",
              "event"
            ]
          },
          "expiresAt": {
            "anyOf": [
              {
                "type": "string",
                "format": "date-time",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "mints",
          "cap",
          "triggerType",
          "expiresAt"
        ],
        "additionalProperties": false
      },
      "swigRole": {
        "type": "object",
        "properties": {
          "roleId": {
            "type": "string",
            "minLength": 1
          },
          "authority": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          },
          "program": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          },
          "tokenRecurringLimit": {
            "type": "object",
            "properties": {
              "mint": {
                "type": "string",
                "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
              },
              "amount": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              "windowSeconds": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "mint",
              "amount",
              "windowSeconds"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "roleId",
          "authority",
          "program",
          "tokenRecurringLimit"
        ],
        "additionalProperties": false
      },
      "jupiterOrderId": {
        "anyOf": [
          {
            "type": "string",
            "minLength": 1
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "spec",
      "swigRole",
      "jupiterOrderId"
    ],
    "additionalProperties": false
  }
}
```

## What the schemas do not say

Some rules are cross-field and JSON Schema cannot express them, so they are enforced when the
call is parsed rather than described here. A verdict that is not `pass` must carry at least one
reason. A reason carrying a number must carry its limit and its unit too, because a number
without either cannot be shown to anyone. A coverage share must equal its own counts rather than
being reported separately. An incomplete read must say why it stopped.

A call that breaks one of those is refused with the reason, not silently accepted.
