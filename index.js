var gutil = require("gulp-util"),
	through = require("through2"),
	fs = require("fs"),
	path = require("path");

module.exports = function (options) {
	options = options || {};
	options.filename = options.filename || "variables.less";

	return through.obj(function (file, enc, cb) {
		if (file.isNull()) {
			return cb(null, file);
		}
		if (file.isStream()) {
			return cb(new gutil.PluginError("gulp-less-variables", "Streaming not supported"));
		}

		// Find all less files being @import'd
		var getFilePath = function (importFile, paths) {
			var i, l = paths.length;
			for (i = 0; i < l; i++) {
				var file = path.resolve(paths[i], importFile);
				if (fs.existsSync(file)) {
					return file;
				}
			}
			return null;
		};

		var files = {};
		var variablesFile;
		var importRegex = /^\s*?@import\s+(['"])(.*)\1\s*;/gm;
		var findFiles = function (file) {
			if (files[file.path]) {
				return;
			}
			files[file.path] = file;

			var content;
			if (file.contents) {
				content = file.contents.toString("utf8");
			} else {
				content = fs.readFileSync(file.path).toString("utf8");
				file.contents = new Buffer(content);
			}

			if (path.basename(file.path) == options.filename) {
				variablesFile = file.path;
				return;
			}

			var match;
			while ((match = importRegex.exec(content)) != null) {
				match = getFilePath(match[2], [
					file.base,
					file.cwd
				]);
				if (match && !files[match]) {
					findFiles(new gutil.File({
						base: path.dirname(match),
						cwd: file.cwd,
						path: match
					}));
				}
			}
		};
		findFiles(file);

		// Find first comment block and all variables in files
		var variables = {};
		var variablesFileMap = {};
		var varRegex = /^@(.*?)\s*?:\s*(.*?)\s*;/gm;

		var comments = {};
		var commentsRegex = /\/\*+\s*((?:.*?\s*?)+?)\s*\*+\//;
		var commentsReplaceRegex = /^\s*\**\s*/gm;
		try {
			Object.keys(files).forEach(function (filename) {
				if (path.basename(filename) == options.filename) {
					return;
				}

				var file = files[filename];
				var content = file.contents.toString("utf8");

				var relPath = path.relative(file.cwd, file.path);
				variables[relPath] = {};

				var match, field, value;
				while ((match = varRegex.exec(content)) != null) {
					field = match[1];
					value = match[2];

					if (variablesFileMap[field]) {
						throw new gutil.PluginError("gulp-less-variables", "Variable `" + field + "` is defined first in `" + variablesFileMap[field] + "` and again in `" + relPath + "`.");
					}
					variablesFileMap[field] = relPath;

					variables[relPath][field] = value;
				}

				match = content.match(commentsRegex);
				if (match) {
					comments[relPath] = match[1].replace(commentsReplaceRegex, " * ");
				}
			});
		} catch (e) {
			return cb(e);
		}

		// Find all variables in existing variables file
		var existingVars = {},
			removedFiles = [];
		if (variablesFile && files[variablesFile]) {
			(function () {
				var content = files[variablesFile].contents.toString("utf8");
				content = content.split("//* ");
				content.forEach(function (block) {
					block = block.split(" *//");

					var filename = block[0];
					var varBlock = block[1];

					if (!filename) {
						return;
					}

					var commentBlock = varBlock.match(commentsRegex);
					if (commentBlock) {
						commentBlock = commentBlock[1].replace(commentsReplaceRegex, " * ");
						varBlock.replace(commentsRegex, "");
						comments[filename] = commentBlock;
					}

					if (!variables[filename]) {
						removedFiles.push(filename);
					}

					existingVars[filename] = {};

					var match, field, value;
					while ((match = varRegex.exec(varBlock)) != null) {
						field = match[1];
						value = match[2];

						var fn = filename;
						if (variablesFileMap[field]) {
							fn = variablesFileMap[field];
							if (!existingVars[fn]) {
								existingVars[fn] = {};
							}
						}
						existingVars[fn][field] = value;
						variablesFileMap[field] = variablesFile;
					}
				});
			})();
		}

		// Merge variables and existing variable values
		Object.keys(variables).forEach(function (filename) {
			var fileVars = variables[filename];
			var replaceVars = existingVars[filename];
			if (!replaceVars) {
				return;
			}
			Object.keys(replaceVars).forEach(function (field) {
				fileVars[field] = replaceVars[field];
			});
		});
		removedFiles.forEach(function (filename) {
			variables[filename] = existingVars[filename];
		});

		// Format output text
		var longestFieldLength = 0;
		Object.keys(variablesFileMap).forEach(function (field) {
			longestFieldLength = Math.max(longestFieldLength, field.length);
		});

		var fullOutput = [];
		Object.keys(variables).sort().forEach(function (filename) {
			var fileOutput = [];

			fileOutput.push("//* " + filename + " *//");
			if (comments[filename]) {
				fileOutput.push("/*");
				fileOutput.push(comments[filename]);
				fileOutput.push(" */");
			}
			var fileVars = variables[filename];
			if (Object.keys(fileVars).length == 0) {
				return;
			}
			Object.keys(fileVars).sort().forEach(function (field) {
				fileOutput.push("@" + field + ":   " + (new Array(longestFieldLength - field.length + 1)).join(" ") + fileVars[field] + ";");
			});

			fullOutput.push(fileOutput.join("\n"));
		});
		fullOutput = fullOutput.join("\n\n\n");

		// Return file
		cb(null, new gutil.File({
			cwd: file.cwd,
			base: file.base,
			path: path.resolve(file.base, options.filename),
			contents: new Buffer(fullOutput)
		}));
	})
};