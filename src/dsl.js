if(!eve.data) {
  eve.data = {globalId: 0};
}

eve.test = {};
var dsl = eve.dsl = {};

dsl.nextId = function() {
  return "i" + eve.data.globalId++;
}

dsl.globalNames = {};
dsl.tableToFields = {};

dsl.nameToId = function(name, rule) {
  if(rule) {
    return rule.names[name] || dsl.globalNames[name];
  }
  return dsl.globalNames[name];
}

dsl.parseName = function(name) {
  return name.split(".");
}

dsl.table = function(name, fields) {
  var items = [];
  dsl.globalNames[name] = name;
  dsl.tableToFields[name] = fields;
  items.push(["displayNames", name, name]);
  fields.forEach(function(field, ix) {
    var id = dsl.nextId();
    items.push(["schema", name, id, ix]);
    items.push(["displayNames", id, field]);
    dsl.globalNames[name + "." + field] = id;
  });
  return items;
}

var Rule = function(desc) {
  this.id = dsl.nextId();
  this.ix = 0;
  this.sortIx = 0;
  this.names = {};
  this.items = [["rule", this.id, desc]];
}

dsl.rule = function(desc, func) {
  var r = new Rule(desc);
  func(r);
  return r;
}

Rule.prototype.source = function(name, alias) {
  var id = dsl.nameToId(name);
  var pipeId = dsl.nextId();
  this.names[alias || name] = pipeId;
  if(alias) {
    dsl.tableToFields[name].forEach(function(cur) {
      dsl.globalNames[alias + "." + cur] = dsl.globalNames[name + "." + cur];
    });
  }
  this.items.push(["pipe", pipeId, id, this.id, "+source"]);
}

Rule.prototype.sink = function(name, alias) {
  var id = dsl.nameToId(name);
  var pipeId = dsl.nextId();
  this.names[alias || name] = pipeId;
  if(alias) {
    dsl.tableToFields[name].forEach(function(cur) {
      dsl.globalNames[alias + "." + cur] = dsl.globalNames[name + "." + cur];
    });
  }
  this.items.push(["pipe", pipeId, id, this.id, "+sink"]);
}

Rule.prototype.negated = function(name, alias) {
  var id = dsl.nameToId(name);
  var pipeId = dsl.nextId();
  this.names[alias || name] = pipeId;
  if(alias) {
    dsl.tableToFields[name].forEach(function(cur) {
      dsl.globalNames[alias + "." + cur] = dsl.globalNames[name + "." + cur];
    });
  }
  this.items.push(["pipe", pipeId, id, this.id, "-source"]);
}

Rule.prototype.valve = function() {
  var valve = dsl.nextId();
  this.items.push(["valve", valve, this.id, this.ix++]);
  return valve;
}

Rule.prototype.fieldToValve = function(from) {
  var valve = this.names[from];
  if(!valve) {
    var fromParts = dsl.parseName(from);
    valve = this.valve();
    var pipe = dsl.nameToId(fromParts[0], this);
    var field = dsl.nameToId(from);
    this.names[from] = valve;
    this.items.push(["tableConstraint", valve, pipe, field],
                    ["displayNames", valve, from]);
  }
  return valve;
}

Rule.prototype.eq = function(from, value) {
  var valve = this.fieldToValve(from);
  this.items.push(["constantConstraint", valve, value]);
}

Rule.prototype.output = function(from, to) {
  var valve = this.fieldToValve(from);
  var toParts = dsl.parseName(to);
  var pipe = dsl.nameToId(toParts[0], this);
  var field = dsl.nameToId(to);
  this.items.push(["tableConstraint", valve, pipe, field]);
}

Rule.prototype.outputConstant = function(val, to) {
  var valve = this.valve();
  var toParts = dsl.parseName(to);
  var pipe = dsl.nameToId(toParts[0], this);
  var field = dsl.nameToId(to);
  this.items.push(["constantConstraint", valve, val],
                  ["tableConstraint", valve, pipe, field]);
}

Rule.prototype.join = function(from, to) {
  var valve = this.fieldToValve(from);
  var toParts = dsl.parseName(to);
  var pipe = dsl.nameToId(toParts[0], this);
  var field = dsl.nameToId(to);
  this.items.push(["tableConstraint", valve, pipe, field],
                  ["join", valve, pipe, field]);
}

Rule.prototype.sort = function(name) {
  var valve = this.fieldToValve(name);
  this.items.push(["sortValve", this.id, valve, this.sortIx++]);
}

Rule.prototype.group = function(name) {
  var valve = this.fieldToValve(name);
  this.items.push(["groupValve", this.id, valve]);
}

Rule.prototype.filter = function(name, code) {
  var input = this.fieldToValve(name);
  var valve = this.valve();
  var id = dsl.nextId();
  code = code.replace(name, input);
  this.items.push(
    ["function", id, code, valve, this.id],
    ["functionInput", input, id],
    ["constantConstraint", valve, true]
  );
}

Rule.prototype.calculate = function(name, args, code) {
  var valve = this.valve();
  var id = dsl.nextId();
  this.names[name] = valve;

  var self = this;
  args.forEach(function(cur) {
    var valve = self.fieldToValve(cur);
    self.items.push(["functionInput", valve, id]);
    code = code.replace(cur, valve);
  });

  this.items.push(["function", id, code, valve, this.id]);
}

Rule.prototype.aggregate = function(input, output, code) {
  var inputValve = this.fieldToValve(input);
  var valve = this.valve();
  code = code.replace(input, inputValve);
  this.names[output] = valve;
  this.items.push(["reducer", this.id, inputValve, valve, code],
                  ["displayNames", valve, output]);
}

Rule.prototype.limit = function(from) {
  var valve = this.fieldToValve(from);
  this.items.push(["limitValve", this.id, valve]);
}

Rule.prototype.constantLimit = function(num) {
  var valve = this.valve();
  this.items.push(["limitValve", this.id, valve],
                  ["constantConstraint", valve, num]);
}

Rule.prototype.concat = function(arr) {
  arr.forEach(function(cur) {
    this.items.push(cur);
  });
}

Rule.prototype.ui = function(elem) {
  elem(this, null, 0);
}

var DSLSystem = function() {
  this.system = compileSystem(Memory.fromFacts(compilerSchema));
  this.facts = [];
}

DSLSystem.prototype.rule = function(name, func) {
  var rule = dsl.rule(name, func);
  for(var i in rule.items) {
    this.facts.push(rule.items[i]);
  }
}

DSLSystem.prototype.table = function(name, fields) {
  var items = dsl.table(name, fields);
  for(var i in items) {
    this.facts.push(items[i]);
  }
}

DSLSystem.prototype.compile = function() {
  this.system = compileSystem(Memory.fromFacts(compilerSchema.concat(this.facts)));
}

DSLSystem.prototype.input = function(items) {
  this.system.update(items, []);
}

DSLSystem.prototype.empty = function() {
  this.system.memory = Memory.empty();
}

DSLSystem.prototype.equal = function(facts) {
  memoryEqual(this.system.memory, Memory.fromFacts(facts))
}

DSLSystem.prototype.test = function(inputs, results) {
  this.empty();
  this.input(inputs);
  this.equal(inputs.concat(results));
}

dsl.system = function() {
  return new DSLSystem();
}

//*********************************************************
// ui
//*********************************************************

var ui = eve.ui = {}

ui.events = {
  "click": true,
  "doubleClick": true,
  "contextMenu": true
}

ui.prefixId = function(rule, prefix, col) {
  console.log("prefixID:", prefix, col);
  var id = dsl.nextId();
  rule.calculate(id, [col], "'" + prefix + "_' + " + col);
  return id;
}

ui.postfixId = function(rule, col, postfix) {
  var id = dsl.nextId();
  rule.calculate(id, [col], col +  " + '_" + postfix + "'");
  return id;
}

ui.ref = function(col) {
  return function(rule, nameValve, ix) {
    if(nameValve) {
      var sink = nameValve + "_sink_" + ix;
      var id = ui.postfixId(rule, nameValve, ix);
      rule.sink("ui_text", sink);
      rule.output(col, sink + ".text");
      rule.output(id, sink + ".id");
      return id;
    } else {
      return col;
    }
  }
}

ui.elem = function() {
  var args = arguments;
  return function(rule, nameValve, ix) {
//     console.log("elem: ", nameValve, ix);
    var sink = nameValve + "_sink_" + ix;
    if(args[1] && args[1].id) {
      var id = ui.prefixId(rule, args[1].id[0], args[1].id[1]);
    } else {
      if(nameValve) {
        var id = ui.postfixId(rule, nameValve, ix);
      } else {
        throw new Error("No initial id provided for ui element");
      }
    }
    rule.sink("ui_elems", sink);
    rule.outputConstant(args[0], sink + ".type");
    console.log("Output: ", id, sink+ ".id");
    rule.output(id, sink + ".id");
    for(var i in args[1]) {
      var attr = args[1][i];
      if(i === 'id') {
        //id

      } else if(i === 'style') {
        //styles
        for(var style in attr) {
          var value = attr[style];
          var sink = id + "_stylesink_" + style;
          rule.sink("ui_styles", sink);
          rule.output(id, sink + ".id");
          rule.outputConstant(style, sink + ".attr");
          if(typeof value === "function") {
            var valve = value(rule);
            rule.output(valve, sink + ".value");
          } else {
            rule.outputConstant(value, sink + ".value");
          }
        }
      } else if(ui.events[i]) {
        //event handler
        var sink = id + "_eventsink_" + i;
        rule.sink("ui_events", sink);
        rule.output(id, sink + ".id");
        rule.outputConstant(i, sink + ".event");
        var field = [".label", ".key"];
        for(var x in attr) {
          if(typeof attr[x] === "function") {
            var valve = attr[x](rule);
            rule.output(valve, sink + field[x]);
          } else {
            rule.outputConstant(attr[x], sink + field[x]);
          }
        }
      } else {
        //normal attribute
        var sink = id + "_attrsink_" + i;
        rule.sink("ui_attrs", sink);
        rule.output(id, sink + ".id");
        rule.outputConstant(i, sink + ".attr");
        if(typeof attr === "function") {
          var valve = attr(rule);
          rule.output(valve, sink + ".value");
        } else {
          rule.outputConstant(attr, sink + ".value");
        }
      }

    }
    args[2].forEach(function(cur, ix) {
      if(typeof cur === "function") {
        var childId = cur(rule, id, ix);
        var childSink = textId + "_childsink_ " + ix;
        //           console.log("child: ", id, ix, childId);
        rule.sink("ui_child", childSink);
        rule.output(id, childSink + ".parent");
        rule.output(childId, childSink + ".child");
        rule.outputConstant(ix, childSink + ".pos");
      } else {
        var textId = ui.postfixId(rule, id, ix);
        var textSink = textId + "_sink_" + ix;
        var textChild = textId + "childsink";
        //           console.log("text: ", ix, textId);
        rule.sink("ui_text", textSink);
        rule.sink("ui_child", textChild);
        rule.output(textId, textSink + ".id");
        rule.outputConstant(cur, textSink + ".text");
        rule.output(id, textChild + ".parent");
        rule.output(textId, textChild + ".child");
        rule.outputConstant(ix, textChild + ".pos");
      }
    });
    return id;
  }
}

//*********************************************************
// Test
//*********************************************************

eve.test.wrapCommonTables = function(sys) {
  sys.table("displayNames", ["id", "name"]);
  sys.table("joins", ["id", "valve", "pipe", "field"]);
  sys.table("clicks", ["id"]);
  sys.table("sms outbox", ["id"]);
  sys.table("users", ["id", "name"]);
  sys.table("edges", ["from", "to"]);
  sys.table("path", ["from", "to"]);
  sys.table("rule", ["id", "description"]);
  sys.table("ui_elems", ["id", "type"]);
  sys.table("ui_text", ["id", "text"]);
  sys.table("ui_child", ["parent", "pos", "child"]);
  sys.table("ui_attrs", ["id", "attr", "value"]);
  sys.table("ui_styles", ["id", "attr", "value"]);
  sys.table("ui_events", ["id", "event", "label", "key"]);
  sys.table("external_events", ["id", "label", "key", "eid"]);
  sys.table("time", ["time"]);
}

eve.test.test = function(name, func, inputs, expected) {
  var sys = dsl.system();
  eve.test.wrapCommonTables(sys);
  try {
    func(sys);
    sys.compile();
    sys.test(inputs, expected);
  } catch(e) {
    eve.test.failed = true;
    console.log(sys);
    console.error("failed test: " + name);
    console.error("    " + e.stack);
    return false;
  }
  return true;
}

eve.test.check = function() {
  if(eve.test.failed) {
    process.exit(1);
  }
}

//*********************************************************
// Rules
//*********************************************************

// eve.test.test("simple join",
//               function(sys) {
//                 sys.rule("this is a cool rule", function(rule) {
//                   rule.source("clicks");
//                   rule.sink("sms outbox");
//                   rule.output("clicks.id", "sms outbox.id");
//                 });
//               },
//               [["users", 5, "chris"], ["clicks", 5]],
//               [["sms outbox", 5]]);

// sys.rule("this is a cool rule", function(rule) {
//   rule.source("clicks");
//   rule.source("users");
//   rule.sink("sms outbox");
//   rule.join("clicks.id", "users.id");
//   rule.output("users.name", "sms outbox.id");
//   rule.output("clicks.id", "sms outbox.id");
//   rule.aggregate("clicks.id", "cool", "console.log(clicks.id)");
//    rule.filter("clicks.id", "clicks.id > 28");
//   rule.sort("clicks.id");
//   rule.group("clicks.id");
//   rule.calculate("foo", ["clicks.id"], "clicks.id + 5");
//   rule.eq("foo", 23);
//   rule.output("cool", "sms outbox.id");
// })



// sys.input([["clicks", 5], ["clicks", 20], ["clicks", 9], ["users", 5, "chris"]]);

// sys.rule("edges yo", function(rule) {
//   rule.source("edges");
//   rule.sink("path");
//   rule.output("edges.to", "path.to");
//   rule.output("edges.from", "path.from");
//   rule.limit(1);
// });

// sys.rule("edges and paths, oh my", function(rule) {
//   rule.source("edges");
//   rule.source("path", "input path");
//   rule.sink("path");
//   rule.join("edges.to", "input path.from");
//   rule.output("edges.from", "path.from");
//   rule.output("input path.to", "path.to");
// })

// sys.facts
// sys.compile();
// sys.system.memory.getFacts();
// sys.test([["users", 5, "chris"], ["clicks", 5]], [["sms outbox", "chris"]]);

// console.time("edges");
// sys.input([["edges", "a", "b"],
//            ["edges", "b", "c"],
//            ["edges", "c", "d"],
//            ["edges", "d", "b"],
//            ["edges", "d", "e"],
//            ["edges", "e", "f"],
//            ["edges", "f", "g"],
//            ["edges", "g", "a"]]);
// console.timeEnd("edges");


// sys.system.memory.getFacts();

// sys.system.memory.getTable("path");
