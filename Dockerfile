FROM ghcr.io/5etools-mirror-3/5etools-img:latest

COPY . /var/www/localhost/htdocs/

# The entrypoint turns the container's environment into the site's default book selection, then
# hands over to the server. Kept out of the web root — it is a build detail, not a page.
RUN mv /var/www/localhost/htdocs/docker/entrypoint.sh /docker-entrypoint.sh \
	&& chmod +x /docker-entrypoint.sh \
	&& rm -rf /var/www/localhost/htdocs/docker

ENTRYPOINT ["/docker-entrypoint.sh"]
# Restating the base image's own command, because setting ENTRYPOINT discards the inherited CMD
CMD ["lighttpd", "-D", "-f", "/etc/lighttpd/lighttpd.conf"]
