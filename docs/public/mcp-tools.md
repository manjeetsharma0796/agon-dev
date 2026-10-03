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

Returns a link to the arming screen. The user connects their own wallet there and sets the limit from what their history suggests; this tool never names one.

**Input**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "mints": {
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
      }
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
    },
    "agent": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    }
  },
  "required": [
    "mints",
    "triggerType",
    "expiresAt"
  ],
  "additionalProperties": false
}
```

**Output**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    },
    "wallet": {
      "anyOf": [
        {
          "type": "string",
          "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
        },
        {
          "type": "null"
        }
      ]
    },
    "agent": {
      "anyOf": [
        {
          "type": "string",
          "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
        },
        {
          "type": "null"
        }
      ]
    },
    "note": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "url",
    "wallet",
    "agent",
    "note"
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
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "wallet": {
                "type": "string",
                "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
              },
              "mints": {
                "minItems": 1,
                "type": "array",
                "items": {
                  "type": "string",
                  "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
                }
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
              "wallet",
              "mints",
              "triggerType",
              "expiresAt"
            ],
            "additionalProperties": false
          },
          {
            "type": "null"
          }
        ]
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
              },
              "windowSlots": {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "mint",
              "amount"
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
      },
      "vault": {
        "type": "string",
        "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
      },
      "owner": {
        "type": "string",
        "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
      },
      "effectiveRemaining": {
        "type": "string",
        "pattern": "^(0|[1-9][0-9]*)$"
      },
      "rollingWorstCase": {
        "type": "string",
        "pattern": "^(0|[1-9][0-9]*)$"
      }
    },
    "required": [
      "spec",
      "swigRole",
      "jupiterOrderId",
      "vault",
      "owner",
      "effectiveRemaining",
      "rollingWorstCase"
    ],
    "additionalProperties": false
  }
}
```

## `prepare_swap`



**Input**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "owner": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "historyWallet": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "agent": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "inputMint": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "outputMint": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "amount": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$"
    },
    "slippageBps": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "owner",
    "historyWallet",
    "agent",
    "inputMint",
    "outputMint",
    "amount",
    "slippageBps"
  ]
}
```

**Output**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "transaction": {
      "type": "string",
      "minLength": 1
    },
    "vault": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "verdict": {
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
    },
    "quote": {
      "type": "object",
      "properties": {
        "inAmount": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$"
        },
        "outAmount": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$"
        },
        "minOutAmount": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$"
        },
        "slippageBps": {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        "route": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          }
        }
      },
      "required": [
        "inAmount",
        "outAmount",
        "minOutAmount",
        "slippageBps",
        "route"
      ],
      "additionalProperties": false
    },
    "effectiveRemaining": {
      "type": "string",
      "pattern": "^(0|[1-9][0-9]*)$"
    },
    "lastValidBlockHeight": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "unitsConsumed": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "transaction",
    "vault",
    "verdict",
    "quote",
    "effectiveRemaining",
    "lastValidBlockHeight",
    "unitsConsumed"
  ],
  "additionalProperties": false
}
```

## `vault_status`



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
    "vault": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "owner": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "summary": {
      "minItems": 1,
      "maxItems": 8,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      }
    },
    "totals": {
      "type": "object",
      "properties": {
        "realised": {
          "type": "object",
          "properties": {
            "sol": {
              "type": "object",
              "properties": {
                "amount": {
                  "type": "string",
                  "pattern": "^-?(0|[1-9][0-9]*)$"
                },
                "ui": {
                  "type": "string",
                  "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$"
                },
                "unit": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "required": [
                "amount",
                "ui",
                "unit"
              ],
              "additionalProperties": false
            },
            "usd": {
              "anyOf": [
                {
                  "type": "string",
                  "pattern": "^-?[0-9]+\\.[0-9]{2}$"
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "required": [
            "sol",
            "usd"
          ],
          "additionalProperties": false
        },
        "unrealised": {
          "type": "object",
          "properties": {
            "sol": {
              "type": "object",
              "properties": {
                "amount": {
                  "type": "string",
                  "pattern": "^-?(0|[1-9][0-9]*)$"
                },
                "ui": {
                  "type": "string",
                  "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$"
                },
                "unit": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "required": [
                "amount",
                "ui",
                "unit"
              ],
              "additionalProperties": false
            },
            "usd": {
              "anyOf": [
                {
                  "type": "string",
                  "pattern": "^-?[0-9]+\\.[0-9]{2}$"
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "required": [
            "sol",
            "usd"
          ],
          "additionalProperties": false
        },
        "total": {
          "type": "object",
          "properties": {
            "sol": {
              "type": "object",
              "properties": {
                "amount": {
                  "type": "string",
                  "pattern": "^-?(0|[1-9][0-9]*)$"
                },
                "ui": {
                  "type": "string",
                  "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$"
                },
                "unit": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "required": [
                "amount",
                "ui",
                "unit"
              ],
              "additionalProperties": false
            },
            "usd": {
              "anyOf": [
                {
                  "type": "string",
                  "pattern": "^-?[0-9]+\\.[0-9]{2}$"
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "required": [
            "sol",
            "usd"
          ],
          "additionalProperties": false
        },
        "unpriced": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          }
        },
        "note": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "realised",
        "unrealised",
        "total",
        "unpriced",
        "note"
      ],
      "additionalProperties": false
    },
    "solUsd": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "usd": {
              "type": "string",
              "minLength": 1
            },
            "sources": {
              "minItems": 1,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1
                  },
                  "usd": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "required": [
                  "name",
                  "usd"
                ],
                "additionalProperties": false
              }
            },
            "spreadPct": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "usd",
            "sources",
            "spreadPct"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "positions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "mint": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          },
          "held": {
            "type": "object",
            "properties": {
              "amount": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              "ui": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
              },
              "unit": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "amount",
              "ui",
              "unit"
            ],
            "additionalProperties": false
          },
          "cost": {
            "type": "object",
            "properties": {
              "amount": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              "ui": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
              },
              "unit": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "amount",
              "ui",
              "unit"
            ],
            "additionalProperties": false
          },
          "value": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "amount": {
                    "type": "string",
                    "pattern": "^(0|[1-9][0-9]*)$"
                  },
                  "ui": {
                    "type": "string",
                    "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
                  },
                  "unit": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "required": [
                  "amount",
                  "ui",
                  "unit"
                ],
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          },
          "unrealised": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "sol": {
                    "type": "object",
                    "properties": {
                      "amount": {
                        "type": "string",
                        "pattern": "^-?(0|[1-9][0-9]*)$"
                      },
                      "ui": {
                        "type": "string",
                        "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$"
                      },
                      "unit": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "amount",
                      "ui",
                      "unit"
                    ],
                    "additionalProperties": false
                  },
                  "usd": {
                    "anyOf": [
                      {
                        "type": "string",
                        "pattern": "^-?[0-9]+\\.[0-9]{2}$"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  }
                },
                "required": [
                  "sol",
                  "usd"
                ],
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          },
          "source": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1
              },
              {
                "type": "null"
              }
            ]
          },
          "whyUnpriced": {
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
          "mint",
          "held",
          "cost",
          "value",
          "unrealised",
          "source",
          "whyUnpriced"
        ],
        "additionalProperties": false
      }
    },
    "balances": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "mint": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          },
          "held": {
            "type": "object",
            "properties": {
              "amount": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              "ui": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
              },
              "unit": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "amount",
              "ui",
              "unit"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "mint",
          "held"
        ],
        "additionalProperties": false
      }
    },
    "nativeSol": {
      "type": "object",
      "properties": {
        "amount": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)$"
        },
        "ui": {
          "type": "string",
          "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
        },
        "unit": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "amount",
        "ui",
        "unit"
      ],
      "additionalProperties": false
    },
    "agents": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "address": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          },
          "feeSol": {
            "type": "object",
            "properties": {
              "amount": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              "ui": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
              },
              "unit": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "amount",
              "ui",
              "unit"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "address",
          "feeSol"
        ],
        "additionalProperties": false
      }
    },
    "trades": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "signature": {
            "type": "string",
            "minLength": 1
          },
          "slot": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "time": {
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
          },
          "side": {
            "type": "string",
            "enum": [
              "buy",
              "sell"
            ]
          },
          "mint": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          },
          "token": {
            "type": "object",
            "properties": {
              "amount": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              "ui": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
              },
              "unit": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "amount",
              "ui",
              "unit"
            ],
            "additionalProperties": false
          },
          "sol": {
            "type": "object",
            "properties": {
              "amount": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              "ui": {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)(\\.[0-9]+)?$"
              },
              "unit": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "amount",
              "ui",
              "unit"
            ],
            "additionalProperties": false
          },
          "realised": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "amount": {
                    "type": "string",
                    "pattern": "^-?(0|[1-9][0-9]*)$"
                  },
                  "ui": {
                    "type": "string",
                    "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$"
                  },
                  "unit": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "required": [
                  "amount",
                  "ui",
                  "unit"
                ],
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          },
          "explorer": {
            "type": "string",
            "format": "uri"
          }
        },
        "required": [
          "signature",
          "slot",
          "time",
          "side",
          "mint",
          "token",
          "sol",
          "realised",
          "explorer"
        ],
        "additionalProperties": false
      }
    },
    "history": {
      "type": "object",
      "properties": {
        "trades": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "shown": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "positions": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "positionsShown": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "balances": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "signaturesRead": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "complete": {
          "type": "boolean"
        },
        "incomplete": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1
            },
            {
              "type": "null"
            }
          ]
        },
        "notCounted": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
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
              "count",
              "reason"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "trades",
        "shown",
        "positions",
        "positionsShown",
        "balances",
        "signaturesRead",
        "complete",
        "incomplete",
        "notCounted"
      ],
      "additionalProperties": false
    },
    "explorer": {
      "type": "string",
      "format": "uri"
    },
    "dataSlot": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "asOf": {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
    }
  },
  "required": [
    "vault",
    "owner",
    "summary",
    "totals",
    "solUsd",
    "positions",
    "balances",
    "nativeSol",
    "agents",
    "trades",
    "history",
    "explorer",
    "dataSlot",
    "asOf"
  ],
  "additionalProperties": false
}
```

## `sync_fork`



**Input**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "inputMint": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "outputMint": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    }
  },
  "additionalProperties": false
}
```

**Output**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "clockLagBeforeMs": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "clockLagAfterMs": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
    },
    "clockMoved": {
      "type": "boolean"
    },
    "refreshedAccounts": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "pair": {
      "type": "array",
      "prefixItems": [
        {
          "type": "string",
          "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
        },
        {
          "type": "string",
          "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
        }
      ],
      "items": false,
      "minItems": 2,
      "maxItems": 2
    },
    "note": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "clockLagBeforeMs",
    "clockLagAfterMs",
    "clockMoved",
    "refreshedAccounts",
    "pair",
    "note"
  ],
  "additionalProperties": false
}
```

## `get_activity`



**Input**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "wallet": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "signer": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
    },
    "nonce": {
      "type": "string",
      "pattern": "^[0-9a-f]{64}$"
    },
    "signature": {
      "type": "string",
      "pattern": "^[1-9A-HJ-NP-Za-km-z]{64,88}$"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10
    },
    "unattributed": {
      "type": "boolean"
    }
  },
  "required": [
    "wallet"
  ],
  "additionalProperties": false
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
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          },
          "time": {
            "type": "string",
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
          },
          "slot": {
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
          "network": {
            "type": "string",
            "enum": [
              "fork",
              "devnet",
              "mainnet",
              "unset"
            ]
          },
          "wallet": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          },
          "actor": {
            "type": "string",
            "enum": [
              "owner-web",
              "owner-terminal",
              "agent",
              "unattributed"
            ]
          },
          "actorKey": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "action": {
            "type": "string",
            "enum": [
              "check_trade",
              "buy",
              "sell",
              "cancel",
              "pause",
              "note"
            ]
          },
          "mint": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "side": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "buy",
                  "sell"
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "size": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              {
                "type": "null"
              }
            ]
          },
          "received": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^(0|[1-9][0-9]*)$"
              },
              {
                "type": "null"
              }
            ]
          },
          "verdict": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "pass",
                  "block",
                  "unsure"
                ]
              },
              {
                "type": "null"
              }
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
          "ruleVersion": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1
              },
              {
                "type": "null"
              }
            ]
          },
          "signature": {
            "anyOf": [
              {
                "type": "string",
                "pattern": "^[1-9A-HJ-NP-Za-km-z]{64,88}$"
              },
              {
                "type": "null"
              }
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "checked",
              "refused",
              "proposed",
              "approved",
              "declined",
              "expired",
              "sent",
              "confirmed",
              "failed",
              "uncertain"
            ]
          },
          "note": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          }
        },
        "required": [
          "id",
          "time",
          "slot",
          "network",
          "wallet",
          "actor",
          "actorKey",
          "action",
          "mint",
          "side",
          "size",
          "received",
          "verdict",
          "reasons",
          "ruleVersion",
          "signature",
          "status"
        ],
        "additionalProperties": false
      }
    },
    "writeFailures": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "time": {
            "type": "string",
            "format": "date-time",
            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$"
          },
          "wallet": {
            "type": "string",
            "pattern": "^[1-9A-HJ-NP-Za-km-z]{32,44}$"
          },
          "action": {
            "type": "string",
            "enum": [
              "check_trade",
              "buy",
              "sell",
              "cancel",
              "pause",
              "note"
            ]
          },
          "cause": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "time",
          "wallet",
          "action",
          "cause"
        ],
        "additionalProperties": false
      }
    },
    "unattributedHidden": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "basis": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "wallet",
    "rows",
    "writeFailures",
    "unattributedHidden",
    "basis"
  ],
  "additionalProperties": false
}
```

## What the schemas do not say

Some rules are cross-field and JSON Schema cannot express them, so they are enforced when the
call is parsed rather than described here. A verdict that is not `pass` must carry at least one
reason. A reason carrying a number must carry its limit and its unit too, because a number
without either cannot be shown to anyone. A coverage share must equal its own counts rather than
being reported separately. An incomplete read must say why it stopped.

A call that breaks one of those is refused with the reason, not silently accepted.
