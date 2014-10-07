var gulp = require("gulp"),
	lessVars = require("../index.js");

gulp.task("default", function () {
	return gulp.src(
		"less/main.less"
	).pipe(
		lessVars()
	).pipe(gulp.dest(
		"less/"
	));
});